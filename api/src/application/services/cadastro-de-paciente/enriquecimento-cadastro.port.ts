export abstract class EnriquecimentoDeCadastroPort {
    abstract enfileirar(pacienteId: string, tentativa?: number): Promise<void>

    abstract enfileirarSemBloquear(pacienteId: string): Promise<void>
}