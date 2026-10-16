// Typed view of the engine's real zod schema (engine/src/util/Validator.ts). The engine source is not type-checked by this
// project (it has its own tsconfig); tests import it through the alias "@engine-validator" (see vitest.config.mts).
export const ConfigSchema: {
    safeParse(value: unknown): { success: boolean }
    parse(value: unknown): unknown
}
