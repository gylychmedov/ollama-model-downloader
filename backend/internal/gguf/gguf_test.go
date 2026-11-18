package gguf

import (
	"bytes"
	"encoding/binary"
	"testing"
)

func TestRead(t *testing.T) {
	var b bytes.Buffer
	w := func(v any) { _ = binary.Write(&b, binary.LittleEndian, v) }
	str := func(s string) { w(uint64(len(s))); b.WriteString(s) }
	b.WriteString("GGUF")
	w(uint32(3))
	w(uint64(0))
	w(uint64(4))
	str("general.architecture")
	w(uint32(tString))
	str("llama")
	str("llama.context_length")
	w(uint32(tUint32))
	w(uint32(131072))
	str("tokenizer.ggml.tokens")
	w(uint32(tArray))
	w(uint32(tString))
	w(uint64(3))
	str("a")
	str("bb")
	str("ccc")
	str("general.parameter_count")
	w(uint32(tUint64))
	w(uint64(8_000_000_000))

	md, err := Read(&b)
	if err != nil {
		t.Fatal(err)
	}
	if md.String("general.architecture") != "llama" || md.Int("llama.context_length") != 131072 ||
		md.Int("tokenizer.ggml.tokens") != 3 || md.Int("general.parameter_count") != 8_000_000_000 {
		t.Fatalf("unexpected metadata %v", md)
	}
}

func TestReadRejectsOtherFiles(t *testing.T) {
	if _, err := Read(bytes.NewReader([]byte("{\"a\":1}"))); err != ErrNotGGUF {
		t.Fatalf("err = %v", err)
	}
}
