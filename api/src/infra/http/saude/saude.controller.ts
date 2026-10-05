import type { Response } from 'express'
import { Controller, Get, HttpStatus, Res } from '@nestjs/common'

import { SaudeService } from '@/application/services/saude/saude.service'

@Controller('health')
export class SaudeController {
    constructor(private readonly saude: SaudeService) {}

    @Get()
    async verificar(@Res({ passthrough: true }) res: Response) {
        const relatorio = await this.saude.verificar()

        res.status(
            relatorio.status === 'ok'
                ? HttpStatus.OK
                : HttpStatus.SERVICE_UNAVAILABLE,
        )

        return relatorio
    }
}