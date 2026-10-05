export abstract class PublicadorDeEventosPort {
    abstract publicar(
        routingKey: string,
        payload: Record<string, unknown>,
    ): Promise<void>
}