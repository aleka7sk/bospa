package bospa

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"

	"golang.org/x/crypto/bcrypt"
)

const bcryptCost = 12

func HashPassword(password string) (string, error) {
	if len(password) < 12 {
		return "", fmt.Errorf("password must contain at least 12 characters")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("hash password: %w", err)
	}
	return string(hash), nil
}

func VerifyPassword(hash, password string) bool {
	return bcrypt.CompareHashAndPassword([]byte(hash), []byte(password)) == nil
}

func NewSecret() (raw string, digest []byte, err error) {
	buffer := make([]byte, 32)
	if _, err := rand.Read(buffer); err != nil {
		return "", nil, fmt.Errorf("generate random secret: %w", err)
	}
	raw = base64.RawURLEncoding.EncodeToString(buffer)
	sum := sha256.Sum256([]byte(raw))
	return raw, sum[:], nil
}

func DigestSecret(raw string) []byte {
	sum := sha256.Sum256([]byte(raw))
	return sum[:]
}

func SecretMatches(raw string, expected []byte) bool {
	actual := DigestSecret(raw)
	if len(actual) != len(expected) {
		return false
	}
	return subtle.ConstantTimeCompare(actual, expected) == 1
}
