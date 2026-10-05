import { ChecagemDeDependencia } from '@/application/services/saude/saude.service'
import { Injectable } from '@nestjs/common'
import { PrismaService } from '@/infra/database/prisma/prisma.service'

@Injectable()
export class ChecagemDoBanco implements ChecagemDeDependencia {
    readonly nome = 'postgres'

    constructor(private readonly prisma: PrismaService) {}

    async verificar(): Promise<void> {
        await this.prisma.$queryRaw`SELECT 1`
    }
}