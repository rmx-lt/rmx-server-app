// Package arch checks the import rules of the repository layout (wiki
// Server-App, "Repository layout"). Default deny: every package must be in
// the layer table below, and may import only what its layer allows. A new
// package therefore fails here until it is given a layer.
//
// contracts_test.go checks the links that are not imports (wiki Server-App,
// "Module map"): each domain's tables, internal/api files and MQTT topics,
// the declared links between domains, and what each integration test file
// covers.
package arch
