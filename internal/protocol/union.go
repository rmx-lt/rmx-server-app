package protocol

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
)

// A union is a JSON object whose "tag" member says which variant it is, like
// {"status": "error", "error": {...}}. In Go it is a struct holding the
// variant in V. The same Union description drives the JSON codec here and the
// TypeScript generator (cmd/gen-ts), so the two cannot drift apart.

// Variant is one case of a Union.
type Variant struct {
	// Tag is the value of the tag member.
	Tag string
	// Type is the variant's struct type (not a pointer).
	Type reflect.Type
}

// Union describes a tagged union.
type Union struct {
	// Name is the Go and TypeScript type name.
	Name string
	// Tag is the name of the JSON member that holds the variant's tag.
	Tag      string
	Variants []Variant
}

func variant[T any](tag string) Variant { return Variant{Tag: tag, Type: reflect.TypeFor[T]()} }

var (
	requestUnion = &Union{Name: "Request", Tag: "op", Variants: []Variant{
		variant[RequestPing]("ping"),
	}}
	rpcResultUnion = &Union{Name: "RpcResult", Tag: "status", Variants: []Variant{
		variant[RpcOk]("ok"),
		variant[RpcError]("error"),
	}}
	rpcDataUnion = &Union{Name: "RpcData", Tag: "kind", Variants: []Variant{
		variant[RpcPong]("pong"),
	}}
	serverMessageUnion = &Union{Name: "ServerMessage", Tag: "type", Variants: []Variant{
		variant[MsgResponse]("response"),
	}}
)

// Unions lists every union, for the TypeScript generator.
var Unions = []*Union{requestUnion, rpcResultUnion, rpcDataUnion, serverMessageUnion}

// Enum is a string type with a fixed set of values.
type Enum struct {
	Name   string
	Type   reflect.Type
	Values []string
}

// Enums lists every enum, for the TypeScript generator.
var Enums = []Enum{
	{"ErrorCode", reflect.TypeFor[ErrorCode](), []string{
		"bad_request", "not_found", "internal", "unauthorized", "forbidden", "too_many_requests",
	}},
}

// Structs lists every plain struct, for the TypeScript generator.
var Structs = []reflect.Type{
	reflect.TypeFor[RequestEnvelope](),
	reflect.TypeFor[ResponseEnvelope](),
	reflect.TypeFor[ApiError](),
	reflect.TypeFor[Health](),
	reflect.TypeFor[LoginRequest](),
	reflect.TypeFor[Me](),
}

func (u *Union) marshal(v any) ([]byte, error) {
	t := reflect.TypeOf(v)
	if t != nil && t.Kind() == reflect.Pointer {
		v = reflect.ValueOf(v).Elem().Interface()
		t = t.Elem()
	}
	for _, variant := range u.Variants {
		if variant.Type != t {
			continue
		}
		body, err := json.Marshal(v)
		if err != nil {
			return nil, err
		}
		tag, _ := json.Marshal(variant.Tag)
		var out bytes.Buffer
		out.WriteString(`{"` + u.Tag + `":`)
		out.Write(tag)
		if len(body) > 2 { // not just {}
			out.WriteByte(',')
			out.Write(body[1:])
		} else {
			out.WriteByte('}')
		}
		return out.Bytes(), nil
	}
	return nil, fmt.Errorf("protocol: %T is not a variant of %s", v, u.Name)
}

func (u *Union) unmarshal(data []byte) (any, error) {
	var members map[string]json.RawMessage
	if err := json.Unmarshal(data, &members); err != nil {
		return nil, fmt.Errorf("%s: %w", u.Name, err)
	}
	rawTag, ok := members[u.Tag]
	if !ok {
		return nil, fmt.Errorf("%s: missing field `%s`", u.Name, u.Tag)
	}
	var tag string
	if err := json.Unmarshal(rawTag, &tag); err != nil {
		return nil, fmt.Errorf("%s: field `%s` must be a string", u.Name, u.Tag)
	}
	for _, variant := range u.Variants {
		if variant.Tag != tag {
			continue
		}
		ptr := reflect.New(variant.Type)
		if err := Unmarshal(data, ptr.Interface()); err != nil {
			return nil, fmt.Errorf("%s %q: %w", u.Name, tag, err)
		}
		return ptr.Elem().Interface(), nil
	}
	tags := make([]string, len(u.Variants))
	for i, v := range u.Variants {
		tags[i] = "`" + v.Tag + "`"
	}
	return nil, fmt.Errorf("%s: unknown variant `%s`, expected one of %s", u.Name, tag, strings.Join(tags, ", "))
}

func (r Request) MarshalJSON() ([]byte, error)        { return requestUnion.marshal(r.V) }
func (r *Request) UnmarshalJSON(b []byte) (err error) { r.V, err = requestUnion.unmarshal(b); return }

func (r RpcResult) MarshalJSON() ([]byte, error) { return rpcResultUnion.marshal(r.V) }
func (r *RpcResult) UnmarshalJSON(b []byte) (err error) {
	r.V, err = rpcResultUnion.unmarshal(b)
	return
}

func (r RpcData) MarshalJSON() ([]byte, error)        { return rpcDataUnion.marshal(r.V) }
func (r *RpcData) UnmarshalJSON(b []byte) (err error) { r.V, err = rpcDataUnion.unmarshal(b); return }

func (m ServerMessage) MarshalJSON() ([]byte, error) { return serverMessageUnion.marshal(m.V) }
func (m *ServerMessage) UnmarshalJSON(b []byte) (err error) {
	m.V, err = serverMessageUnion.unmarshal(b)
	return
}

// Unmarshal is json.Unmarshal that also insists on every member of a struct
// that is not a pointer: a missing member or a null in its place is an error,
// where encoding/json would quietly leave the zero value. Pointer members
// (Go's way to say "may be null") are optional. Only the top-level struct is
// checked; nested types check themselves when they have their own UnmarshalJSON.
func Unmarshal(data []byte, v any) error {
	if err := json.Unmarshal(data, v); err != nil {
		return err
	}
	t := reflect.TypeOf(v)
	for t.Kind() == reflect.Pointer {
		t = t.Elem()
	}
	if t.Kind() != reflect.Struct {
		return nil
	}
	var members map[string]json.RawMessage
	if err := json.Unmarshal(data, &members); err != nil {
		return err
	}
	var problems []error
	for i := 0; i < t.NumField(); i++ {
		f := t.Field(i)
		name, ok := JSONName(f)
		if !ok || f.Type.Kind() == reflect.Pointer {
			continue
		}
		raw, present := members[name]
		switch {
		case !present:
			problems = append(problems, fmt.Errorf("missing field `%s`", name))
		case string(bytes.TrimSpace(raw)) == "null":
			problems = append(problems, fmt.Errorf("field `%s` must not be null", name))
		}
	}
	return errors.Join(problems...)
}

// JSONName is the JSON member name of a struct field, and false if the field
// is not part of the JSON.
func JSONName(f reflect.StructField) (string, bool) {
	if !f.IsExported() {
		return "", false
	}
	tag := f.Tag.Get("json")
	if tag == "-" {
		return "", false
	}
	name, _, _ := strings.Cut(tag, ",")
	if name == "" {
		name = f.Name
	}
	return name, true
}
