// Package gguf reads the metadata header of a GGUF model file.
package gguf

import (
	"bufio"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
)

const (
	tUint8 = iota
	tInt8
	tUint16
	tInt16
	tUint32
	tInt32
	tFloat32
	tBool
	tString
	tArray
	tUint64
	tInt64
	tFloat64
)

var ErrNotGGUF = errors.New("not a gguf file")

// Metadata maps keys to scalar values; arrays are stored as their length (int64).
type Metadata map[string]any

// ReadFile parses the key/value header of a GGUF file without reading tensors.
func ReadFile(path string) (Metadata, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	return Read(f)
}

func Read(r io.Reader) (Metadata, error) {
	p := &parser{r: bufio.NewReaderSize(r, 1<<20)}
	var magic [4]byte
	if _, err := io.ReadFull(p.r, magic[:]); err != nil || string(magic[:]) != "GGUF" {
		return nil, ErrNotGGUF
	}
	version := p.u32()
	if version < 2 {
		return nil, fmt.Errorf("gguf version %d is not supported", version)
	}
	_ = p.u64()
	n := p.u64()
	if p.err == nil && n > 1<<20 {
		return nil, fmt.Errorf("gguf header has %d keys", n)
	}
	md := Metadata{}
	for i := uint64(0); i < n && p.err == nil; i++ {
		key := p.str()
		typ := p.u32()
		if typ == tArray {
			elem := p.u32()
			count := p.u64()
			p.skipArray(elem, count)
			md[key] = int64(count)
			continue
		}
		md[key] = p.value(typ)
	}
	if p.err != nil {
		return nil, p.err
	}
	return md, nil
}

func (m Metadata) String(key string) string {
	s, _ := m[key].(string)
	return s
}

func (m Metadata) Int(key string) int64 {
	switch v := m[key].(type) {
	case int64:
		return v
	case uint64:
		if v > math.MaxInt64 {
			return math.MaxInt64
		}
		return int64(v)
	case float64:
		return int64(v)
	}
	return 0
}

type parser struct {
	r   *bufio.Reader
	err error
}

func (p *parser) read(n int) []byte {
	if p.err != nil {
		return nil
	}
	b := make([]byte, n)
	if _, err := io.ReadFull(p.r, b); err != nil {
		p.err = err
		return nil
	}
	return b
}

func (p *parser) u32() uint32 {
	if b := p.read(4); b != nil {
		return binary.LittleEndian.Uint32(b)
	}
	return 0
}

func (p *parser) u64() uint64 {
	if b := p.read(8); b != nil {
		return binary.LittleEndian.Uint64(b)
	}
	return 0
}

func (p *parser) str() string {
	n := p.u64()
	if p.err == nil && n > 64<<20 {
		p.err = fmt.Errorf("gguf string of %d bytes", n)
	}
	if p.err != nil {
		return ""
	}
	return string(p.read(int(n)))
}

func (p *parser) skip(n uint64) {
	if p.err != nil {
		return
	}
	if _, err := p.r.Discard(int(n)); err != nil {
		p.err = err
	}
}

func size(typ uint32) (uint64, bool) {
	switch typ {
	case tUint8, tInt8, tBool:
		return 1, true
	case tUint16, tInt16:
		return 2, true
	case tUint32, tInt32, tFloat32:
		return 4, true
	case tUint64, tInt64, tFloat64:
		return 8, true
	}
	return 0, false
}

func (p *parser) skipArray(elem uint32, count uint64) {
	if p.err != nil {
		return
	}
	if sz, ok := size(elem); ok {
		if count > 1<<34/sz {
			p.err = fmt.Errorf("gguf array of %d elements", count)
			return
		}
		p.skip(sz * count)
		return
	}
	if elem != tString {
		p.err = fmt.Errorf("gguf array of type %d is not supported", elem)
		return
	}
	for i := uint64(0); i < count && p.err == nil; i++ {
		p.skip(p.u64())
	}
}

func (p *parser) value(typ uint32) any {
	switch typ {
	case tString:
		return p.str()
	case tBool:
		b := p.read(1)
		return b != nil && b[0] != 0
	case tFloat32:
		return float64(math.Float32frombits(p.u32()))
	case tFloat64:
		return math.Float64frombits(p.u64())
	case tUint64:
		return p.u64()
	}
	sz, ok := size(typ)
	if !ok {
		p.err = fmt.Errorf("gguf value of type %d is not supported", typ)
		return nil
	}
	b := p.read(int(sz))
	if b == nil {
		return int64(0)
	}
	switch typ {
	case tUint8:
		return int64(b[0])
	case tInt8:
		return int64(int8(b[0]))
	case tUint16:
		return int64(binary.LittleEndian.Uint16(b))
	case tInt16:
		return int64(int16(binary.LittleEndian.Uint16(b)))
	case tUint32:
		return int64(binary.LittleEndian.Uint32(b))
	case tInt32:
		return int64(int32(binary.LittleEndian.Uint32(b)))
	case tInt64:
		return int64(binary.LittleEndian.Uint64(b))
	}
	return nil
}
