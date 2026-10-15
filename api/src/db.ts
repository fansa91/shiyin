/**
 * MySQL 连接池 (云端同步用)。
 *
 * 环境变量:
 *   SHIYIN_DB_HOST      数据库主机 (未设置 = 未配置, 同步接口返回 503, 不影响 rss/charts)
 *   SHIYIN_DB_PORT      端口, 默认 3306
 *   SHIYIN_DB_USER      用户名
 *   SHIYIN_DB_PASSWORD  密码
 *   SHIYIN_DB_NAME      库名
 *   SHIYIN_DB_SSL_CA    可选: CA 证书文件路径 (Oracle Cloud MySQL 等需显式指定)
 *   SHIYIN_DB_SSL_VERIFY 可选: "false" 关闭服务端证书校验 (默认 "true" 校验)。
 *     降级选项, 有中间人攻击风险, 仅建议自建内网/可信网络使用。
 *     典型场景: Oracle MySQL 自签证书链导致 HANDSHAKE_SSL_ERROR 且暂时拿不到 CA 文件。
 *
 * SSL 默认开启且校验服务端证书 (rejectUnauthorized: true)。
 * 未指定 SHIYIN_DB_SSL_CA 时使用系统 CA 池; 若服务端 CA 不在系统池内
 * (如 Oracle 自签 CA), 连接会失败, 此时必须用 SHIYIN_DB_SSL_CA 指定 CA 文件。
 */
import mysql from 'mysql2/promise'
import fs from 'node:fs'

let pool: mysql.Pool | null = null
let configured: boolean | null = null

/** 是否配置了数据库 (只看 HOST, 其余给默认值/报错) */
export function dbConfigured(): boolean {
  if (configured === null) configured = !!process.env.SHIYIN_DB_HOST
  return configured
}

/** 未配置返回 null, 调用方据此返回 503, 不抛异常 */
export function getPool(): mysql.Pool | null {
  if (!dbConfigured()) return null
  if (!pool) {
    const caPath = process.env.SHIYIN_DB_SSL_CA
    // "false" 关闭证书校验: 降级选项, 有中间人风险, 仅建议自建内网/可信网络使用
    const verify = (process.env.SHIYIN_DB_SSL_VERIFY ?? 'true').toLowerCase() !== 'false'
    if (!verify) console.warn('[db] WARNING: SHIYIN_DB_SSL_VERIFY=false, 跳过服务端证书校验')
    pool = mysql.createPool({
      host: process.env.SHIYIN_DB_HOST,
      port: Number(process.env.SHIYIN_DB_PORT ?? 3306),
      user: process.env.SHIYIN_DB_USER,
      password: process.env.SHIYIN_DB_PASSWORD,
      database: process.env.SHIYIN_DB_NAME,
      // 默认校验服务端证书; 有 CA 文件则显式加载; 关闭校验时直接放行
      ssl: !verify
        ? { rejectUnauthorized: false }
        : caPath
          ? { ca: fs.readFileSync(caPath), rejectUnauthorized: true }
          : { rejectUnauthorized: true },
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      // JSON 列自动解析为对象
      decimalNumbers: false,
    })
  }
  return pool
}
