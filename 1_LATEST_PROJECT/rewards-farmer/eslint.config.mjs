import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
    { ignores: ['engine/**', 'node_modules/**', 'dist/**', 'out/**', 'release/**', 'coverage/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        files: ['**/*.ts', '**/*.tsx', '**/*.mjs'],
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/consistent-type-imports': 'error',
            'no-console': 'warn'
        }
    },
    {
        // Node scripts: declare the globals they use, console output is their job.
        files: ['scripts/**/*.mjs'],
        languageOptions: {
            globals: {
                console: 'readonly',
                process: 'readonly',
                setTimeout: 'readonly',
                fetch: 'readonly',
                WebSocket: 'readonly',
                Buffer: 'readonly'
            }
        },
        rules: { 'no-console': 'off' }
    },
    {
        // Test fixture that runs as a plain Node process (stands in for the bot in tests only).
        files: ['tests/fixtures/**/*.cjs'],
        languageOptions: {
            sourceType: 'commonjs',
            globals: { process: 'readonly', setTimeout: 'readonly', setInterval: 'readonly' }
        }
    }
)
