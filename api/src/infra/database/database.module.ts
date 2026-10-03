import { CheckInRepository } from '@/application/repositories/checkin-repository'
import { Module } from '@nestjs/common'
import { PrismaCheckInRepository } from './prisma/repositories/prisma-checkin-repository'
import { PrismaService } from './prisma/prisma.service'

@Module({
    providers: [
        PrismaService,
        {
            provide: CheckInRepository,
            useClass: PrismaCheckInRepository,
        },
    ],
    exports: [PrismaService],
})
export class DatabaseModule {}
