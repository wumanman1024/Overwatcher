import { app } from 'electron'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import Database from 'better-sqlite3'
import type { Database as DatabaseType } from 'better-sqlite3'
import { normalizeModelConfig, normalizeModelList } from '@localforge/shared/model-config'
import type { ModelConfig, ModelConfigInput } from '@localforge/shared/model-config'

/*
 * 模型配置库。文件落在 app.getPath('userData')/localforge.db，
 * Windows 上即 %APPDATA%\@localforge\desktop\localforge.db，用户可直接查看与备份。
 *
 * 列名与 ModelConfig 字段一一对应；is_default 全表至多一条，由 setDefault 的事务保证。
 * api_key 明文存储（内网环境，用户确认无需加密）。
 */
const SCHEMA_VERSION = 1

let database: DatabaseType | null = null
let openError: string | null = null

function openDatabase(): DatabaseType {
  if (database) return database
  if (openError) throw new Error(`模型数据库不可用：${openError}`)
  try {
    const path = join(app.getPath('userData'), 'localforge.db')
    database = new Database(path)
    database.pragma('journal_mode = WAL')
    migrate(database)
    return database
  } catch (error) {
    // 原生模块缺失或文件损坏只让模型功能不可用，不能让主进程起不来，故记下原因延后抛出。
    openError = error instanceof Error ? error.message : String(error)
    throw new Error(`模型数据库不可用：${openError}`)
  }
}

function migrate(db: DatabaseType): void {
  const version = db.pragma('user_version', { simple: true }) as number
  if (version >= SCHEMA_VERSION) return
  db.exec(`
    CREATE TABLE IF NOT EXISTS models (
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL,
      base_url     TEXT NOT NULL,
      model_id     TEXT NOT NULL,
      api_key      TEXT NOT NULL DEFAULT '',
      effort       TEXT NOT NULL DEFAULT 'off',
      temperature  REAL NOT NULL DEFAULT 0.2,
      max_tokens   INTEGER,
      timeout_ms   INTEGER NOT NULL DEFAULT 120000,
      is_default   INTEGER NOT NULL DEFAULT 0,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS models_is_default ON models(is_default);
    PRAGMA user_version = ${SCHEMA_VERSION};
  `)
}

interface ModelRow {
  id: string; name: string; base_url: string; model_id: string; api_key: string
  effort: string; temperature: number; max_tokens: number | null; timeout_ms: number; is_default: number
}

const toRow = (model: ModelConfig & { created_at?: number; updated_at?: number }): ModelRow => ({
  id: model.id,
  name: model.name,
  base_url: model.baseUrl,
  model_id: model.modelId,
  api_key: model.apiKey,
  effort: model.effort,
  temperature: model.temperature,
  max_tokens: model.maxTokens ?? null,
  timeout_ms: model.timeoutMs,
  is_default: model.isDefault ? 1 : 0
})

/** 读出来后再过一遍规整，历史脏行不会流到界面上。 */
const fromRow = (row: ModelRow): ModelConfig | null => normalizeModelConfig({
  id: row.id,
  name: row.name,
  baseUrl: row.base_url,
  modelId: row.model_id,
  apiKey: row.api_key,
  effort: row.effort,
  temperature: row.temperature,
  maxTokens: row.max_tokens ?? undefined,
  timeoutMs: row.timeout_ms,
  isDefault: row.is_default === 1
})

function readAll(): ModelConfig[] {
  const rows = openDatabase().prepare('SELECT * FROM models ORDER BY created_at ASC').all() as ModelRow[]
  return normalizeModelList(rows.map(fromRow).filter((model): model is ModelConfig => model !== null))
}

export function listModels(): ModelConfig[] {
  return readAll()
}

export function saveModel(input: ModelConfigInput, id?: string): ModelConfig {
  if (typeof input !== 'object' || input === null) throw new Error('模型配置无效')
  const db = openDatabase()
  const existing = id ? (db.prepare('SELECT id, created_at FROM models WHERE id = ?').get(id) as { id: string; created_at: number } | undefined) : undefined
  if (id && !existing) throw new Error('要修改的模型不存在')
  const now = Date.now()
  const model = normalizeModelConfig({
    ...input,
    id: existing?.id ?? randomUUID(),
    isDefault: existing ? (db.prepare('SELECT is_default FROM models WHERE id = ?').get(existing.id) as { is_default: number }).is_default === 1 : readAll().length === 0
  })
  if (!model) throw new Error('模型配置无效，请检查服务地址与模型标识')
  const row = toRow(model)
  if (existing) {
    db.prepare(`UPDATE models SET name=@name, base_url=@base_url, model_id=@model_id, api_key=@api_key, effort=@effort,
      temperature=@temperature, max_tokens=@max_tokens, timeout_ms=@timeout_ms, is_default=@is_default, updated_at=@updated_at
      WHERE id=@id`).run({ ...row, updated_at: now })
  } else {
    db.prepare('INSERT INTO models (id, name, base_url, model_id, api_key, effort, temperature, max_tokens, timeout_ms, is_default, created_at, updated_at) VALUES (@id,@name,@base_url,@model_id,@api_key,@effort,@temperature,@max_tokens,@timeout_ms,@is_default,@created_at,@updated_at)')
      .run({ ...row, created_at: now, updated_at: now })
  }
  return model
}

export function deleteModel(id: string): void {
  const db = openDatabase()
  const removed = db.prepare('DELETE FROM models WHERE id = ?').run(id)
  if (!removed.changes) throw new Error('要删除的模型不存在')
  // 删掉的是默认模型时补一个，避免工具无模型可用。
  const defaults = db.prepare('SELECT COUNT(*) AS n FROM models WHERE is_default = 1').get() as { n: number }
  if (!defaults.n) {
    const fallback = db.prepare('SELECT id FROM models ORDER BY created_at ASC LIMIT 1').get() as { id: string } | undefined
    if (fallback) db.prepare('UPDATE models SET is_default = 1 WHERE id = ?').run(fallback.id)
  }
}

export function setDefaultModel(id: string): void {
  const db = openDatabase()
  const found = db.prepare('SELECT id FROM models WHERE id = ?').get(id)
  if (!found) throw new Error('要设为默认的模型不存在')
  // 清 0 与置 1 必须原子，否则中途崩溃会留下零个或多个默认。
  db.transaction(() => {
    db.prepare('UPDATE models SET is_default = 0 WHERE is_default = 1').run()
    db.prepare('UPDATE models SET is_default = 1 WHERE id = ?').run(id)
  })()
}
