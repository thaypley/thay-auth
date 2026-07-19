import bcrypt from 'bcryptjs';

const BCRYPT_COST = 10;

export async function hashPasswordBcrypt(plaintext: string): Promise<string> {
  if (!plaintext) throw new Error('empty password');
  const pw = plaintext.length > 72 ? plaintext.slice(0, 72) : plaintext;
  return bcrypt.hash(pw, BCRYPT_COST);
}
