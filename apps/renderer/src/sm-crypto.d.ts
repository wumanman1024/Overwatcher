declare module 'sm-crypto' {
  export const sm2: {
    generateKeyPairHex(): { privateKey: string; publicKey: string }
    doEncrypt(message: string, publicKey: string, cipherMode?: 0 | 1): string
    doDecrypt(ciphertext: string, privateKey: string, cipherMode?: 0 | 1): string
  }
  export const sm3: (message: string) => string
  export const sm4: {
    encrypt(message: string, key: string, options?: { mode?: 'ecb' | 'cbc'; iv?: string }): string
    decrypt(ciphertext: string, key: string, options?: { mode?: 'ecb' | 'cbc'; iv?: string }): string
  }
}
