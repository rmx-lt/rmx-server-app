package main

import (
	"fmt"
	"regexp"
)

// Firmware update (wiki Mower-Protocol §6.5), the same on both boards: parse
// the command, download over the board's fw topics, check the image.

var fwFileName = regexp.MustCompile(`^[A-Za-z0-9._-]{1,128}$`)

type otaParams struct {
	version, file string
	size          int64
	hasSize       bool
}

// parseOTA checks the parameters; running is the version that runs now.
func parseOTA(env cmdEnv, running string) (p otaParams, code, msg string) {
	v, ok := env.str("version")
	if !ok || v == "" || len(v) > 31 {
		return p, "bad_request", "ota needs a string version (1-31 characters)"
	}
	p.version, p.file = v, v+".bin"
	if env.has("file") {
		if p.file, ok = env.str("file"); !ok || !fwFileName.MatchString(p.file) {
			return p, "bad_request", "file must be a name of A-Za-z0-9._- (1-128 characters)"
		}
	}
	if env.has("size") {
		n, ok := env.num("size")
		if !ok || n < 0 || n != float64(int64(n)) {
			return p, "bad_request", "size must be the image size in bytes"
		}
		p.size, p.hasSize = int64(n), true
	}
	if v == running {
		return p, "same_version", "this version is already running"
	}
	return p, "", ""
}

// verifyImage is what the board checks after the download. The simulator has
// no signature check; an ESP-IDF image carries its version, any other test
// file is accepted.
func verifyImage(p otaParams, image []byte) (code, msg string) {
	if p.hasSize && int64(len(image)) != p.size {
		return "bad_size", fmt.Sprintf("the image is %d bytes, the command says %d", len(image), p.size)
	}
	if v, ok := appVersion(image); ok && v != p.version {
		return "bad_image", "the image has version " + v + ", the command says " + p.version
	}
	return "", ""
}

// downloadError maps a failed download to the error code of the command:
// a file that does not add up is a bad image, anything else did not complete.
func downloadError(err *dlError, bad string) (code, msg string) {
	if err.kind == "corrupt" {
		return bad, err.message
	}
	return "download_failed", err.message
}

func flipPartition(p string) string {
	if p == "ota_0" {
		return "ota_1"
	}
	return "ota_0"
}
