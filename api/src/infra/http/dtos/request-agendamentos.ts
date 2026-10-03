export class RequestAgendamentos200Dto {
  AgendamentoResponse: {
    cpf: string;
    possuiAgendamento: boolean;
    especialidade?: string;
    horario?: string;
    medico?: string;
  };
}

export class RequestAgendamentos500Dto {
  Fault: {
    message: string;
  };
}
