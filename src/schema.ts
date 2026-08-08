export const EPONYME_SCHEMA_VERSION = 2

export const EPONYME_MODEL_NAMES = [
  'Eponyme',
  'EponymeEntryIndex',
  'EponymeIndexState',
  'EponymeVersion',
  'EponymeUser',
  'EponymeUserSession',
  'EponymeFormSubmission',
  'EponymeRateLimit',
  'EponymeSchema',
] as const

export const EPONYME_PRISMA_DELEGATES = [
  'eponyme',
  'eponymeEntryIndex',
  'eponymeIndexState',
  'eponymeVersion',
  'eponymeUser',
  'eponymeUserSession',
  'eponymeFormSubmission',
  'eponymeRateLimit',
  'eponymeSchema',
] as const

export const EPONYME_DATABASE_COLUMNS = {
  eponyme_entries: [
    'name',
    'draft',
    'published',
    'status',
    'publishedAt',
    'scheduledPublishAt',
    'scheduledUnpublishAt',
    'createdAt',
    'updatedAt',
    'deletedAt',
  ],
  eponyme_entry_index: ['entryName', 'version', 'key', 'value'],
  eponyme_index_state: ['name', 'fingerprint', 'updatedAt'],
  eponyme_versions: ['id', 'entryName', 'data', 'action', 'status', 'createdAt', 'userId'],
  eponyme_users: [
    'id',
    'username',
    'usernameNormalized',
    'passwordHash',
    'role',
    'active',
    'mustChangePassword',
    'failedLoginAttempts',
    'lockedUntil',
    'createdAt',
    'updatedAt',
  ],
  eponyme_user_sessions: ['id', 'tokenHash', 'userId', 'expiresAt', 'createdAt'],
  eponyme_form_submissions: ['id', 'formName', 'data', 'createdAt'],
  eponyme_rate_limits: ['key', 'count', 'expiresAt'],
  _eponyme_schema: ['key', 'version', 'updatedAt'],
} as const

export const EPONYME_SCHEMA_MARKER_START = '// <eponyme-schema>'
export const EPONYME_SCHEMA_MARKER_END = '// </eponyme-schema>'
