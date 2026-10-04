import { join, resolve } from 'node:path'
import { readdirSync, statSync } from 'node:fs'

import { spawn } from 'node:child_process'

// Runner de desenvolvimento.
//
// `nest start --watch` não serve aqui: ele sobe `node dist/main.js` sem passar
// pelo `scripts/fix-esm-specifiers.mjs`, e o Node resolve os specifiers do
// arquivo em disco.
//
// A alternativa seria um loader hook do Node para resolver em runtime, mas
// isso entra na frente de todo import e mascara o problema em vez de buildar
// certo. Aqui o build é sempre um `pnpm build` inteiro, o mesmo do `start`.

const RAIZ = resolve(import.meta.dirname, '..')
const SRC = join(RAIZ, 'src')
const ENTRADA = join(RAIZ, 'dist', 'main.js')

const INTERVALO_POLLING_MS = 400
const DEBOUNCE_MS = 250

let app = null
const filhos = new Set()

function rodar(comando, argumentos, opcoes = {}) {
    const filho = spawn(comando, argumentos, {
        cwd: RAIZ,
        stdio: 'inherit',
        ...opcoes,
    })

    filhos.add(filho)

    filho.on('exit', () => {
        filhos.delete(filho)
    })

    return filho
}

function pararApp() {
    if (!app) return

    const morrendo = app
    app = null
    morrendo.kill('SIGTERM')

    const t = setTimeout(() => morrendo.kill('SIGKILL'), 2000)
    morrendo.once('exit', () => clearTimeout(t))
}

function iniciarApp() {
    app = rodar(process.execPath, [ENTRADA])
}

function snapshot() {
    const marca = new Map()

    const andar = (dir) => {
        for (const entrada of readdirSync(dir, { withFileTypes: true })) {
            const caminho = join(dir, entrada.name)

            if (entrada.isDirectory()) {
                andar(caminho)
            } else if (/\.(ts|json|prisma)$/.test(entrada.name)) {
                marca.set(caminho, statSync(caminho).mtimeMs)
            }
        }
    }

    try {
        andar(SRC)
    } catch {}

    return marca
}

function mudou(antes, agora) {
    if (antes.size !== agora.size) return true

    for (const [caminho, mtime] of agora) {
        if (antes.get(caminho) !== mtime) return true
    }

    return false
}

function esperarSaida(filho) {
    return new Promise((resolve) => filho.once('exit', resolve))
}

async function buildar() {
    const isWindows = process.platform === 'win32'
    const filho = isWindows
        ? rodar('cmd.exe', ['/d', '/s', '/c', 'pnpm run build'])
        : rodar('pnpm', ['run', 'build'])

    const codigo = await esperarSaida(filho)

    return codigo === 0
}

async function recompilar() {
    console.log('\n[dev] mudança em src/ detectedada, recompilando...')

    const ok = await buildar()

    if (!ok) {
        console.error(
            '[dev] build falhou; app segue rodando com o código anterior',
        )
        return
    }

    console.log('[dev] build ok, reiniciando app')
    pararApp()
    iniciarApp()
}

async function main() {
    console.log('[dev] build inicial...')

    if (!(await buildar())) {
        console.error(
            '[dev] build inicial falhou; watching src/ para recuperar',
        )
    } else {
        iniciarApp()
    }

    let referencia = snapshot()
    let pendente = null
    let construindo = false

    const timer = setInterval(() => {
        if (construindo) return

        const atual = snapshot()

        if (!mudou(referencia, atual)) return

        referencia = atual

        clearTimeout(pendente)
        pendente = setTimeout(async () => {
            construindo = true

            try {
                await recompilar()
            } catch (erro) {
                console.error('[dev] falha no ciclo de recompilacao:', erro)
            } finally {
                construindo = false
            }
        }, DEBOUNCE_MS)
    }, INTERVALO_POLLING_MS)

    const encerrar = async () => {
        clearInterval(timer)
        clearTimeout(pendente)
        pararApp()

        for (const filho of filhos) {
            filho.kill('SIGTERM')
        }

        process.exit(0)
    }

    process.on('SIGINT', encerrar)
    process.on('SIGTERM', encerrar)
}

await main()
