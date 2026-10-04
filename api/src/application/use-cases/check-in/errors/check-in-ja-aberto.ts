export class CheckInJaAberto extends Error {
    constructor(
        readonly pacienteId: string,
        readonly dataReferencia: Date,
    ) {
        super(
            `Já existe check-in aberto para o paciente ${pacienteId} em ${dataReferencia
                .toISOString()
                .slice(0, 10)}.`,
        )
        this.name = 'CheckInJaAberto'
    }
}
