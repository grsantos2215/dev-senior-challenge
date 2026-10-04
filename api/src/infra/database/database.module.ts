import { AuditoriaPort } from '@/application/services/auditoria/auditoria.port'
import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { Module } from '@nestjs/common'
import { PrismaAuditoriaRepository } from './prisma/repositories/prisma-auditoria.repository'
import { PrismaCheckInRepository } from './prisma/repositories/prisma-checkin-repository'
import { PrismaService } from './prisma/prisma.service'

@Module({
    providers: [
        PrismaService,
        {
            provide: CheckInRepository,
            useClass: PrismaCheckInRepository,
        },
        {
            provide: AuditoriaPort,
            useClass: PrismaAuditoriaRepository,
        },
    ],
    exports: [PrismaService, CheckInRepository, AuditoriaPort],
})
export class DatabaseModule {}
