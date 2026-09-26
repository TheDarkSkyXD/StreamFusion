export interface PayloadSecretBox {
  open(value: string): string;
  seal(plaintext: string): string;
}
