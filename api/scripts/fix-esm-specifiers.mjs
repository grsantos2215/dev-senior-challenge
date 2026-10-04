import { dirname, join, relative, resolve } from 'node:path'
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'

// `@/*` e resolvido contra `DIST`, e nao contra `src`: o `dist` espelha a
// arvore de `src`, entao o alvo correto do alias e o arquivo JA compilado
// (`@/generated/prisma/client` -> `dist/generated/prisma/client.js`).
// Apontar para `src` geraria um caminho que sai do `dist` e nao existe la.
const DIST = resolve(process.argv[2] ?? 'dist')
const SRC_DIR = DIST

/** Arquivos .js sob `dir`, recursivo. */
function* jsFiles(dir) {
    for (const entry of readdirSync(dir)) {
        const full = join(dir, entry)

        if (statSync(full).isDirectory()) {
            yield* jsFiles(full)
        } else if (entry.endsWith('.js')) {
            yield full
        }
    }
}

const FROM = /(\bfrom\s*)(['"])([^'"]+)\2/g

function converter(file) {
    const dir = dirname(file)

    return (code) =>
        code.replace(FROM, (all, from, quote, spec) => {
            // Bare specifier de pacote: nao é nosso.
            if (!spec.startsWith('.') && !spec.startsWith('@/')) return all

            const absolute = spec.startsWith('@/')
                ? join(SRC_DIR, spec.replace(/\.js$/, '').slice(2))
                : join(dir, spec.replace(/\.js$/, ''))

            const rel = relative(dir, absolute).replace(/\\/g, '/')
            const specifier = rel.startsWith('.') ? rel : './' + rel

            return `${from}${quote}${specifier}.js${quote}`
        })
}

let changed = 0

for (const file of jsFiles(DIST)) {
    const original = readFileSync(file, 'utf8')
    const updated = converter(file)(original)

    if (updated !== original) {
        writeFileSync(file, updated)
        changed++
    }
}

console.log(`[fix-esm] ${changed} arquivo(s) reescrito(s) em ${DIST}`)
