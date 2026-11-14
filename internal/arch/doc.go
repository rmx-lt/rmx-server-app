// Package arch checks the import rules of the repository layout (wiki
// Server-App, "Repository layout"). Default deny: every package must be in
// the layer table below, and may import only what its layer allows. A new
// package therefore fails here until it is given a layer.
package arch
