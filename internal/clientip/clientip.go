// Package clientip finds the client's IP address, for the login rate limit.
package clientip

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// Of returns the client's IP for the request.
//
// Behind Caddy, the TCP peer is Caddy, so this uses the last X-Forwarded-For
// entry: the address Caddy itself saw (Caddy replaces whatever the client
// sent, and the app's port is not published, so only Caddy can reach it).
// Without that header (local development), the TCP peer.
func Of(r *http.Request) netip.Addr {
	return FromHeaders(r.Header, r.RemoteAddr)
}

// FromHeaders is Of for a request's headers and its remote address ("ip:port").
func FromHeaders(h http.Header, remoteAddr string) netip.Addr {
	peer := peerAddr(remoteAddr)
	lines := h.Values("X-Forwarded-For")
	if len(lines) == 0 {
		return peer
	}
	last := lines[len(lines)-1]
	if i := strings.LastIndexByte(last, ','); i >= 0 {
		last = last[i+1:]
	}
	if ip, err := netip.ParseAddr(strings.TrimSpace(last)); err == nil {
		return ip
	}
	return peer
}

func peerAddr(remoteAddr string) netip.Addr {
	host, _, err := net.SplitHostPort(remoteAddr)
	if err != nil {
		host = remoteAddr
	}
	if ip, err := netip.ParseAddr(host); err == nil {
		return ip.Unmap()
	}
	return netip.IPv4Unspecified()
}
