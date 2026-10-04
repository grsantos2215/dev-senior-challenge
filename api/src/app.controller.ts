import { Controller, Get, Param, Query } from "@nestjs/common";
import { AppService } from "./app.service";
import axios from "axios";
import { convertXmlToJson } from "./lib/xml-converter";

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get("agendamentos")
  async getAgendamentos(@Query("cpf") cpf: string) {
    try {
      const api = await axios.get(
        `${process.env.AGENDAMENTO_URL}/agendamento?cpf=${cpf}`,
      );

      const result = convertXmlToJson(api.data);

      return result;
    } catch (error) {
      throw new Error(`Failed to fetch agendamentos, ${error}`);
    }
  }
}
