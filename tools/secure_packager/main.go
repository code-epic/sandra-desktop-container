package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"fmt"
	"io"
	"os"

	"golang.org/x/crypto/argon2"
)

// Constantes deben coincidir con Rust
const PACKAGE_SALT = "SANDRA_SECURE_CHANNEL_V1"

func main() {
	if len(os.Args) < 4 {
		fmt.Println("Uso: go run main.go <target_mac> <output_file> <json_payload_file>")
		os.Exit(1)
	}

	targetMac := os.Args[1]
	outputFile := os.Args[2]
	jsonFile := os.Args[3]

	// 1. Leer Payload JSON
	jsonData, err := os.ReadFile(jsonFile)
	if err != nil {
		panic(err)
	}

	// 2. Derivar Clave (Argon2id)
	salt := []byte(PACKAGE_SALT)
	// Key Len 32 for AES-256
	key := argon2.IDKey([]byte(targetMac), salt, 3, 4096, 1, 32)

	fmt.Printf("Clave Derivada (Hex): %x\n", key)

	// 3. Encriptar AES-256-GCM
	block, err := aes.NewCipher(key)
	if err != nil {
		panic(err)
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		panic(err)
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		panic(err)
	}

	// Seal appends ciphertext to nonce
	ciphertext := gcm.Seal(nonce, nonce, jsonData, nil)

	// 4. Guardar Archivo
	err = os.WriteFile(outputFile, ciphertext, 0644)
	if err != nil {
		panic(err)
	}

	fmt.Printf("Paquete Seguro generado: %s\n", outputFile)
}
