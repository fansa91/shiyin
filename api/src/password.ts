/**
 * 密码哈希: node:crypto scrypt, 不引入 bcrypt/argon2 等 native 依赖。
 *
 * 参数: N=16384, r=8, p=1, 64 字节 key, 16 字节随机盐。
 * 存储格式: scrypt$16384$8$1$<saltHex>$<hashHex>
 * 校验用 timingSafeEqual 防时序攻击。
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto'

/** promisify 的类型定义不含 options 参数, 手动包一层 */
function scryptAsync(
  password: string,
  salt: Buffer,
  keylen: number,
  options: { N: number; r: number; p: number },
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err)
      else resolve(derived as Buffer)
    })
  })
}

const N = 16384
const R = 8
const P = 1
const KEY_LEN = 64
const SALT_LEN = 16
const PREFIX = `scrypt$${N}$${R}$${P}$`

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(SALT_LEN)
  const key = (await scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P }))
  return `${PREFIX}${salt.toString('hex')}$${key.toString('hex')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (typeof stored !== 'string' || !stored.startsWith(PREFIX)) return false
  const parts = stored.split('$')
  // scrypt$N$r$p$saltHex$hashHex -> 6 段
  if (parts.length !== 6) return false
  const [, nStr, rStr, pStr, saltHex, hashHex] = parts
  if (Number(nStr) !== N || Number(rStr) !== R || Number(pStr) !== P) return false
  let salt: Buffer
  let expected: Buffer
  try {
    salt = Buffer.from(saltHex, 'hex')
    expected = Buffer.from(hashHex, 'hex')
  } catch {
    return false
  }
  if (salt.length !== SALT_LEN || expected.length !== KEY_LEN) return false
  let actual: Buffer
  try {
    actual = (await scryptAsync(password, salt, KEY_LEN, { N, r: R, p: P }))
  } catch {
    return false
  }
  return timingSafeEqual(actual, expected)
}
