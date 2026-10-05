import { useState, type FormEvent, type ReactNode } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import {
  Activity, ArrowDown, ArrowLeft, ArrowRight, Ban, CalendarDays, Check, CheckCircle2,
  CircleAlert, Clock3, Fingerprint, HeartPulse, LoaderCircle, LockKeyhole, Plus, RefreshCw,
  Search, ShieldCheck, Stethoscope, UserRound, Users,
} from "lucide-react"
import { api, ApiError } from "@/lib/api"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardHeader, CardPanel, CardTitle } from "@/components/ui/card"
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Separator } from "@/components/ui/separator"
import { Skeleton } from "@/components/ui/skeleton"

type Status = "AGUARDANDO" | "EM_ATENDIMENTO" | "FINALIZADO" | "CANCELADO"
type Booking = "PRESENTE" | "AUSENTE" | "INDISPONIVEL"
type CheckIn = {
  id: string; status: Status; dataReferencia: string; pacienteId: string
  statusAgendamento: Booking; especialidade: string | null; medico: string | null
  horario: string | null; iniciadoEm: string | null; finalizadoEm: string | null
  criadoEm: string; atualizadoEm: string
}
type PatientCheckIns = { pacienteId: string; checkins: CheckIn[] }
type CreateResult = CheckIn & { nome: string | null; enriquecimentoPendente: boolean }

const queryKey = (cpf: string) => ["check-ins", cpf] as const
const digits = (value: string) => value.replace(/\D/g, "").slice(0, 11)
const formatCpf = (value: string) => value.replace(/\D/g, "").slice(0, 11)
  .replace(/(\d{3})(\d)/, "$1.$2").replace(/(\d{3})(\d)/, "$1.$2")
  .replace(/(\d{3})(\d{1,2})$/, "$1-$2")
const formatTime = (value: string | null) => value ? new Intl.DateTimeFormat("pt-BR", { hour: "2-digit", minute: "2-digit" }).format(new Date(value)) : "—"
const formatDate = (value: string) => new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date(`${value.slice(0, 10)}T12:00:00`))

function messageFor(error: unknown) {
  if (error instanceof ApiError) {
    if (error.status === 404) return "Não encontramos um cadastro com este CPF. Confira os números e tente novamente."
    if (error.status === 409) return "Já existe um check-in aberto para este paciente hoje. Atualize a fila para acompanhar o atendimento."
    if (error.status === 400) return "Confira o CPF informado. Ele precisa conter 11 números."
    if (error.status >= 500) return "O serviço está temporariamente indisponível. Tente novamente em instantes."
  }
  return error instanceof Error ? error.message : "Não foi possível concluir a operação. Tente novamente."
}

function StatusBadge({ status }: { status: Status }) {
  const variants: Record<Status, "warning" | "info" | "success" | "secondary"> = {
    AGUARDANDO: "warning", EM_ATENDIMENTO: "info", FINALIZADO: "success", CANCELADO: "secondary",
  }
  const labels: Record<Status, string> = {
    AGUARDANDO: "Aguardando", EM_ATENDIMENTO: "Em atendimento", FINALIZADO: "Finalizado", CANCELADO: "Cancelado",
  }
  return <Badge variant={variants[status]} className="rounded-full px-2.5">{labels[status]}</Badge>
}

function BookingBadge({ status }: { status: Booking }) {
  if (status === "PRESENTE") return <Badge variant="success" className="rounded-full">Agendamento confirmado</Badge>
  if (status === "AUSENTE") return <Badge variant="secondary" className="rounded-full">Sem agendamento</Badge>
  return <Badge variant="warning" className="rounded-full">Agendamento indisponível</Badge>
}

export default function App() {
  return window.location.pathname.replace(/\/$/, "") === "/recepcao"
    ? <ReceptionPage />
    : <KioskPage />
}

function KioskPage() {
  const [cpfInput, setCpfInput] = useState("")
  const [result, setResult] = useState<CreateResult | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const createMutation = useMutation({
    mutationFn: (cpf: string) => api.post("check-ins", { json: { cpf } }).json<CreateResult>(),
    onSuccess: (checkin) => {
      setResult(checkin)
      setErrorMessage(null)
    },
    onError: (error) => {
      setErrorMessage(error instanceof ApiError && error.status === 409
        ? "Já existe um check-in em aberto para este CPF hoje. Procure a recepção para continuar."
        : messageFor(error))
    },
  })

  function submitCpf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const cpf = digits(cpfInput)
    if (cpf.length !== 11) {
      setErrorMessage("Digite os 11 números do CPF para continuar.")
      return
    }
    setErrorMessage(null)
    createMutation.mutate(cpf)
  }

  return (
    <div className="flex min-h-screen flex-col bg-[#f5f8f6] text-[#172522]">
      <header className="border-b border-[#e8eeeb] bg-white">
        <div className="mx-auto flex h-[76px] max-w-6xl items-center justify-between px-5 md:px-8">
          <a className="flex items-center gap-3" href="/" aria-label="Aurora Centro Médico">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[#e8f4ee] text-[#277252]"><HeartPulse size={22} strokeWidth={2.2} /></span>
            <span><span className="block text-[15px] font-semibold tracking-[-0.03em]">Aurora</span><span className="block text-[10px] tracking-[0.12em] text-[#839189]">CENTRO MÉDICO</span></span>
          </a>
          <span className="hidden items-center gap-2 text-xs font-medium text-[#7e8c85] sm:flex"><span className="size-2 rounded-full bg-emerald-500"/> Totem de atendimento</span>
        </div>
      </header>

      <main className="flex flex-1 items-center justify-center px-5 py-10">
        <div className="grid w-full max-w-[940px] overflow-hidden rounded-[28px] border border-[#e5ece8] bg-white shadow-[0_24px_80px_-44px_rgba(26,60,44,0.28)] md:grid-cols-[1.1fr_0.9fr]">
          <section className="px-6 py-9 sm:px-10 sm:py-12 md:px-12">
            <div className="mb-8 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-[#6f887a]"><span className="flex size-7 items-center justify-center rounded-full bg-[#edf5f0] text-[#397656]">01</span> Identificação do paciente</div>
            {result ? <div className="flex min-h-[340px] flex-col justify-center">
              <span className="mb-5 flex size-14 items-center justify-center rounded-2xl bg-[#e8f5ed] text-[#32805b]"><CheckCircle2 size={29}/></span>
              <Badge variant="success" className="mb-3 w-fit rounded-full">Check-in confirmado</Badge>
              <h1 className="text-3xl font-semibold tracking-[-0.045em]">{result.nome ? `Olá, ${result.nome.split(" ")[0]}!` : "Sua chegada foi registrada."}</h1>
              <p className="mt-3 max-w-sm text-sm leading-6 text-[#74827b]">Seu check-in foi enviado para a recepção. Nossa equipe vai chamar você em breve.</p>
              {result.enriquecimentoPendente && <p className="mt-4 flex items-center gap-2 text-xs text-[#8a7954]"><CircleAlert size={15}/> Seu cadastro está sendo confirmado.</p>}
              <div className="mt-8 rounded-xl border border-[#e8eeeb] bg-[#f8faf9] p-4"><p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b9991]">Próxima etapa</p><p className="mt-1 text-sm font-medium">Aguarde a chamada da recepção</p></div>
              <Button variant="outline" className="mt-6 h-11 w-fit" onClick={() => { setResult(null); setCpfInput("") }}><ArrowLeft size={15}/> Voltar ao início</Button>
            </div> : <>
              <h1 className="text-[32px] font-semibold tracking-[-0.05em] sm:text-[38px]">Bem-vindo(a)</h1>
              <p className="mt-2 max-w-md text-sm leading-6 text-[#7c8983]">Para iniciar seu atendimento, informe seu CPF abaixo.</p>
              <form onSubmit={submitCpf} className="mt-8 space-y-5">
                <Field className="gap-2"><FieldLabel htmlFor="kiosk-cpf">CPF</FieldLabel><Input id="kiosk-cpf" inputMode="numeric" autoComplete="off" autoFocus placeholder="000.000.000-00" value={formatCpf(cpfInput)} onChange={(event) => { setCpfInput(digits(event.target.value)); setErrorMessage(null) }} className="h-12 rounded-xl bg-white text-base tracking-[0.04em]"/><FieldDescription>Digite somente os números do documento.</FieldDescription></Field>
                {errorMessage && <Alert variant="error"><CircleAlert size={16}/><AlertDescription>{errorMessage}</AlertDescription></Alert>}
                <Button type="submit" size="lg" className="h-12 w-full rounded-xl bg-[#277252] text-white hover:bg-[#1e6246]" disabled={digits(cpfInput).length !== 11 || createMutation.isPending} loading={createMutation.isPending}>Continuar <ArrowRight size={17}/></Button>
              </form>
              <div className="mt-7 flex items-start gap-2.5 text-[11px] leading-5 text-[#8b9791]"><LockKeyhole size={15} className="mt-0.5 shrink-0 text-[#6d8878]"/><p>Seus dados são usados para localizar seu cadastro e organizar o atendimento.</p></div>
            </>}
          </section>
          <aside className="relative hidden flex-col justify-between overflow-hidden bg-[#edf5f0] p-9 md:flex">
            <div className="absolute -right-20 -top-16 size-72 rounded-full border border-[#dceae0]"/><div className="absolute -right-8 -top-4 size-48 rounded-full border border-[#dceae0]"/>
            <div className="relative"><span className="flex size-12 items-center justify-center rounded-2xl bg-white text-[#347957] shadow-sm"><Fingerprint size={23}/></span><p className="mt-7 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#70907b]">Atendimento simples</p><h2 className="mt-2 max-w-xs text-[27px] font-semibold leading-tight tracking-[-0.04em]">Estamos aqui para cuidar de você.</h2><p className="mt-3 max-w-xs text-sm leading-6 text-[#72847a]">Faça seu check-in em poucos passos. Se precisar de ajuda, nossa equipe está à disposição.</p></div>
            <div className="relative rounded-2xl border border-white/80 bg-white/75 p-4"><div className="flex items-center gap-3"><span className="flex size-9 items-center justify-center rounded-xl bg-[#e8f4ee] text-[#347957]"><ShieldCheck size={17}/></span><div><p className="text-xs font-semibold">Privacidade respeitada</p><p className="mt-1 text-[10px] text-[#819087]">Seus dados são tratados com cuidado.</p></div></div></div>
          </aside>
        </div>
      </main>
      <footer className="mx-auto flex w-full max-w-6xl items-center justify-between px-5 pb-5 text-[11px] text-[#9aa59f] md:px-8"><span>Aurora Centro Médico · Recepção</span><a href="/recepcao" className="font-medium text-[#6b8174] underline-offset-4 hover:underline">Acesso da recepção</a></footer>
    </div>
  )
}

function ReceptionPage() {
  const client = useQueryClient()
  const [cpfInput, setCpfInput] = useState("")
  const [activeCpf, setActiveCpf] = useState("")
  const [feedback, setFeedback] = useState<{ kind: "error" | "success"; text: string } | null>(null)
  const cpf = digits(activeCpf)
  const patientQuery = useQuery({
    queryKey: queryKey(cpf),
    queryFn: () => api.get("check-ins", { searchParams: { cpf } }).json<PatientCheckIns>(),
    enabled: cpf.length === 11,
    refetchInterval: 15_000,
    retry: (failureCount, error) => !(error instanceof ApiError && error.status < 500) && failureCount < 1,
  })
  const mutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: "iniciar" | "finalizar" | "cancelar" }) =>
      api.post(`check-ins/${id}/${action}`).json<CheckIn>(),
    onSuccess: async () => {
      setFeedback({ kind: "success", text: "Fila atualizada." })
      await client.invalidateQueries({ queryKey: queryKey(cpf) })
    },
    onError: (error) => {
      setFeedback({ kind: "error", text: messageFor(error) })
      if (error instanceof ApiError && error.status === 409) void client.invalidateQueries({ queryKey: queryKey(cpf) })
    },
  })
  const createMutation = useMutation({
    mutationFn: (value: string) => api.post("check-ins", { json: { cpf: value } }).json<CreateResult>(),
    onSuccess: async () => {
      setActiveCpf(digits(cpfInput))
      setFeedback({ kind: "success", text: "Check-in criado. O paciente já entrou na fila de atendimento." })
      await client.invalidateQueries({ queryKey: queryKey(digits(cpfInput)) })
    },
    onError: (error) => {
      setFeedback({ kind: "error", text: messageFor(error) })
      if (error instanceof ApiError && error.status === 409) {
        const value = digits(cpfInput)
        setActiveCpf(value)
        void client.invalidateQueries({ queryKey: queryKey(value) })
      }
    },
  })
  const checkins = patientQuery.data?.checkins ?? []
  const todayCount = checkins.filter((item) => item.dataReferencia.slice(0, 10) === new Date().toISOString().slice(0, 10)).length
  const waitingCount = checkins.filter((item) => item.status === "AGUARDANDO").length
  const inProgressCount = checkins.filter((item) => item.status === "EM_ATENDIMENTO").length
  const patientNotFound = patientQuery.isError && patientQuery.error instanceof ApiError && patientQuery.error.status === 404

  function searchPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const value = digits(cpfInput)
    setFeedback(null)
    if (value.length !== 11) {
      setFeedback({ kind: "error", text: "Digite os 11 números do CPF para consultar a fila." })
      return
    }
    setActiveCpf(value)
  }

  return (
    <div className="min-h-screen bg-[#f6f8f7] text-[#172522]">
      <header className="border-b border-[#e8eeeb] bg-white">
        <div className="mx-auto flex h-[72px] max-w-[1440px] items-center justify-between px-5 md:px-10">
          <a className="flex items-center gap-3" href="#inicio" aria-label="Clínica Aurora, início">
            <span className="flex size-10 items-center justify-center rounded-xl bg-[#e8f4ee] text-[#277252]"><HeartPulse size={22} strokeWidth={2.2} /></span>
            <span><span className="block text-[15px] font-semibold tracking-[-0.03em]">Aurora <span className="font-normal text-[#70807b]">| Recepção</span></span><span className="hidden text-[11px] text-[#8b9792] sm:block">CENTRO MÉDICO</span></span>
          </a>
          <div className="flex items-center gap-3">
            <a href="/" className="hidden rounded-lg px-3 py-2 text-xs font-medium text-[#698074] transition-colors hover:bg-[#f3f7f5] sm:inline-flex">Abrir totem</a>
            <span className="hidden items-center gap-2 rounded-full bg-[#f3f7f5] px-3 py-1.5 text-xs text-[#60736b] sm:flex"><span className="size-1.5 rounded-full bg-emerald-500" /> Unidade Centro</span>
            <Separator orientation="vertical" className="hidden h-8 sm:block" />
            <div className="flex items-center gap-2.5"><span className="flex size-9 items-center justify-center rounded-full bg-[#e9efeb] text-sm font-medium text-[#4c6358]">ER</span><span className="hidden text-sm font-medium sm:block">Equipe de recepção</span></div>
          </div>
        </div>
      </header>

      <main id="inicio" className="mx-auto max-w-[1440px] px-5 py-8 md:px-10 md:py-11">
        <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div><div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.13em] text-[#6d8177]"><Activity size={14} /> Operação clínica</div><h1 className="text-[30px] font-semibold tracking-[-0.045em] md:text-[36px]">Fila de atendimento</h1><p className="mt-1 text-sm text-[#788780]">Acompanhe os check-ins e organize o fluxo de hoje.</p></div>
          <div className="flex items-center gap-2 text-sm text-[#708078]"><CalendarDays size={16} /><span className="capitalize">{new Intl.DateTimeFormat("pt-BR", { dateStyle: "full" }).format(new Date())}</span></div>
        </div>

        <section className="grid gap-4 sm:grid-cols-3" aria-label="Resumo da fila">
          <Metric icon={<Users size={17} />} label="Check-ins de hoje" value={activeCpf ? String(todayCount) : "—"} note={activeCpf ? "deste paciente" : "busque um paciente"} tone="green" />
          <Metric icon={<Clock3 size={17} />} label="Aguardando" value={activeCpf ? String(waitingCount) : "—"} note="na fila consultada" tone="amber" />
          <Metric icon={<Stethoscope size={17} />} label="Em atendimento" value={activeCpf ? String(inProgressCount) : "—"} note="atendimentos ativos" tone="blue" />
        </section>

        <div className="mt-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_360px]">
          <Card className="overflow-hidden rounded-2xl border-[#e6ece9] bg-white shadow-[0_8px_30px_-24px_rgba(26,60,44,0.22)]">
            <CardHeader className="flex flex-row items-center justify-between gap-4 px-5 pb-4 pt-5 md:px-7 md:pt-6">
              <div><CardTitle className="text-base font-semibold tracking-[-0.02em]">Fila do paciente</CardTitle><p className="mt-1 text-xs text-[#829089]">Consulte o histórico e opere os atendimentos ativos.</p></div>
              {activeCpf && <Button variant="outline" size="sm" onClick={() => void patientQuery.refetch()} disabled={patientQuery.isFetching}><RefreshCw size={14} className={patientQuery.isFetching ? "animate-spin" : ""} /> Atualizar</Button>}
            </CardHeader>
            <CardPanel className="px-5 pb-6 md:px-7">
              <form onSubmit={searchPatient} className="flex flex-col gap-3 rounded-xl border border-[#edf1ef] bg-[#fafcfb] p-4 sm:flex-row sm:items-end">
                <Field className="flex-1 gap-1.5"><FieldLabel htmlFor="cpf">CPF do paciente</FieldLabel><Input id="cpf" inputMode="numeric" autoComplete="off" placeholder="000.000.000-00" value={formatCpf(cpfInput)} onChange={(event) => setCpfInput(digits(event.target.value))} className="h-10 rounded-lg bg-white"/><FieldDescription>O CPF é usado somente para localizar o cadastro.</FieldDescription></Field>
                <Button type="submit" variant="outline" className="h-10 border-[#dce6e0] bg-white px-4"><Search size={15} /> Buscar paciente</Button>
                <Button type="button" className="h-10 bg-[#277252] px-4 text-white hover:bg-[#1e6246]" disabled={digits(cpfInput).length !== 11 || createMutation.isPending} loading={createMutation.isPending} onClick={() => { setFeedback(null); createMutation.mutate(digits(cpfInput)) }}><Plus size={16} /> Novo check-in</Button>
              </form>

              {feedback && <Alert className="mt-4" variant={feedback.kind === "error" ? "error" : "success"}><CircleAlert size={16}/><AlertTitle>{feedback.kind === "error" ? "Não foi possível concluir" : "Tudo certo"}</AlertTitle><AlertDescription>{feedback.text}</AlertDescription></Alert>}
              {patientQuery.isError && !patientNotFound && <Alert className="mt-4" variant="error"><CircleAlert size={16}/><AlertTitle>Falha ao consultar a fila</AlertTitle><AlertDescription>{messageFor(patientQuery.error)} <button className="font-medium underline" onClick={() => void patientQuery.refetch()}>Tentar novamente</button></AlertDescription></Alert>}

              <div className="mt-5 overflow-x-auto">
                {!activeCpf ? <PromptState /> : patientQuery.isPending ? <LoadingRows /> : patientNotFound ? <div className="flex flex-col items-center py-12 text-center"><span className="mb-3 flex size-11 items-center justify-center rounded-full bg-[#f0f4f2] text-[#71847a]"><UserRound size={20}/></span><p className="text-sm font-medium">Paciente ainda não localizado</p><p className="mt-1 max-w-sm text-xs leading-5 text-[#84918b]">Confira o CPF ou crie um check-in. Se o cadastro externo estiver indisponível, o atendimento pode continuar com os dados mínimos.</p></div> : checkins.length === 0 ? <div className="flex flex-col items-center py-12 text-center"><span className="mb-3 flex size-11 items-center justify-center rounded-full bg-[#f0f4f2] text-[#71847a]"><CheckCircle2 size={20}/></span><p className="text-sm font-medium">Nenhum check-in encontrado</p><p className="mt-1 text-xs text-[#84918b]">Este paciente ainda não possui registros na fila.</p></div> : <>
                  <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-semibold">{patientQuery.data?.checkins[0]?.pacienteId ? "Paciente localizado" : ""}</p><p className="mt-0.5 text-xs text-[#87938d]">CPF {formatCpf(activeCpf)} <span className="px-1">·</span> {checkins.length} registro{checkins.length === 1 ? "" : "s"}</p></div><span className="flex items-center gap-1.5 text-[11px] text-[#87938d]"><span className="size-1.5 rounded-full bg-emerald-500"/> Atualização automática a cada 15 s</span></div>
                  <div className="min-w-[690px]"><div className="grid grid-cols-[1.2fr_1fr_1fr_1.05fr_auto] gap-3 border-b border-[#edf1ef] px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#98a49e]"><span>Atendimento</span><span>Agendamento</span><span>Horário</span><span>Status</span><span className="text-right">Ações</span></div>
                    <div className="divide-y divide-[#edf1ef]">{[...checkins].sort((a,b) => b.criadoEm.localeCompare(a.criadoEm)).map((item) => <QueueRow key={item.id} item={item} loading={mutation.isPending && mutation.variables?.id === item.id} onAction={(action) => mutation.mutate({ id: item.id, action })}/>)}</div></div>
                </>}
              </div>
            </CardPanel>
          </Card>

          <aside className="space-y-5">
            <Card className="rounded-2xl border-[#e6ece9] bg-white shadow-[0_8px_30px_-24px_rgba(26,60,44,0.22)]"><CardHeader className="px-5 pb-3 pt-5"><CardTitle className="flex items-center gap-2 text-sm font-semibold"><span className="flex size-7 items-center justify-center rounded-lg bg-[#e8f4ee] text-[#277252]"><ArrowDown size={15}/></span> Fluxo de atendimento</CardTitle></CardHeader><CardPanel className="px-5 pb-5"><div className="space-y-0"><FlowStep number="01" title="Recepção" description="Localize o paciente pelo CPF"/><FlowStep number="02" title="Check-in" description="Confirme a entrada na fila"/><FlowStep number="03" title="Atendimento" description="Inicie e finalize o atendimento" last/></div></CardPanel></Card>
            <Card className="rounded-2xl border-[#e6ece9] bg-white shadow-[0_8px_30px_-24px_rgba(26,60,44,0.22)]"><CardPanel className="p-5"><div className="flex gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#edf5f0] text-[#438363]"><ShieldCheck size={18}/></span><div><p className="text-sm font-semibold">Minimização de dados</p><p className="mt-1 text-xs leading-5 text-[#829089]">O CPF serve para localizar o cadastro e permanece apenas durante esta sessão no navegador.</p></div></div><Separator className="my-4"/><div className="flex items-center justify-between text-xs"><span className="text-[#809087]">Auditoria</span><Badge variant="success" className="rounded-full">Sem dados pessoais</Badge></div></CardPanel></Card>
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-[#a0aaa5]"><HeartPulse size={13}/> Cuidado atento em cada etapa</div>
          </aside>
        </div>
      </main>
      <footer className="mx-auto flex max-w-[1440px] justify-between px-5 pb-6 text-[11px] text-[#9aa59f] md:px-10"><span>Aurora Centro Médico · Recepção</span><span>Ambiente de atendimento</span></footer>
    </div>
  )
}

function Metric({ icon, label, value, note, tone }: { icon: ReactNode; label: string; value: string; note: string; tone: "green" | "amber" | "blue" }) {
  const colors = { green: "bg-[#eaf4ee] text-[#34785a]", amber: "bg-[#fbf3e4] text-[#ae7a20]", blue: "bg-[#eaf1f7] text-[#557b9b]" }
  return <Card className="rounded-2xl border-[#e6ece9] bg-white shadow-[0_8px_30px_-24px_rgba(26,60,44,0.22)]"><CardPanel className="flex items-center gap-4 p-5"><span className={`flex size-10 items-center justify-center rounded-xl ${colors[tone]}`}>{icon}</span><div className="min-w-0"><p className="text-xs text-[#7e8c85]">{label}</p><div className="mt-1 flex items-baseline gap-2"><span className="text-2xl font-semibold tracking-[-0.04em]">{value}</span><span className="truncate text-[11px] text-[#9aa59f]">{note}</span></div></div></CardPanel></Card>
}

function QueueRow({ item, loading, onAction }: { item: CheckIn; loading: boolean; onAction: (action: "iniciar" | "finalizar" | "cancelar") => void }) {
  return <div className="grid grid-cols-[1.2fr_1fr_1fr_1.05fr_auto] items-center gap-3 px-3 py-3.5"><div><p className="text-xs font-semibold">{formatDate(item.dataReferencia)}</p><p className="mt-1 text-[10px] text-[#9aa49f]">Entrada às {formatTime(item.criadoEm)}</p></div><div className="flex min-w-0 flex-col items-start gap-1">{item.statusAgendamento === "PRESENTE" && <span className="truncate text-xs font-medium">{item.especialidade}</span>}<BookingBadge status={item.statusAgendamento}/></div><div><p className="text-xs font-medium">{item.horario ?? "—"}</p><p className="mt-1 truncate text-[10px] text-[#97a29c]">{item.medico ?? "Horário"}</p></div><div><StatusBadge status={item.status}/></div><div className="flex justify-end gap-1.5">{item.status === "AGUARDANDO" && <><Button size="sm" className="h-8 bg-[#277252] px-2.5 text-xs text-white hover:bg-[#1e6246]" disabled={loading} onClick={() => onAction("iniciar")}><ArrowRight size={13}/> Iniciar</Button><Button size="icon-sm" variant="ghost" className="text-[#9b7770]" aria-label="Cancelar check-in" disabled={loading} onClick={() => onAction("cancelar")}><Ban size={14}/></Button></>}{item.status === "EM_ATENDIMENTO" && <Button size="sm" className="h-8 bg-[#277252] px-2.5 text-xs text-white hover:bg-[#1e6246]" disabled={loading} onClick={() => onAction("finalizar")}><Check size={14}/> Finalizar</Button>}{(item.status === "FINALIZADO" || item.status === "CANCELADO") && <span className="px-2 text-[10px] text-[#a0aaa5]">Concluído</span>}{loading && <LoaderCircle size={15} className="animate-spin text-[#668575}"/>}</div></div>
}

function FlowStep({ number, title, description, last = false }: { number: string; title: string; description: string; last?: boolean }) {
  return <div className="flex gap-3"><div className="flex flex-col items-center"><span className="flex size-7 items-center justify-center rounded-full border border-[#dfe9e3] bg-[#fbfdfb] text-[10px] font-semibold text-[#58806b]">{number}</span>{!last && <span className="my-1 h-7 w-px bg-[#e7eeea]"/>}</div><div className="pb-5"><p className="text-xs font-semibold">{title}</p><p className="mt-1 text-[11px] text-[#89958f]">{description}</p></div></div>
}

function PromptState() {
  return <div className="flex flex-col items-center py-14 text-center"><span className="mb-3 flex size-12 items-center justify-center rounded-full bg-[#eff5f1] text-[#56836b]"><Search size={20}/></span><p className="text-sm font-medium">Comece buscando um paciente</p><p className="mt-1 max-w-xs text-xs leading-5 text-[#87948d]">Informe o CPF para visualizar os check-ins existentes ou registrar uma nova chegada.</p></div>
}

function LoadingRows() {
  return <div className="space-y-4 py-5">{[0,1,2].map((item) => <div key={item} className="flex items-center gap-4"><Skeleton className="h-10 flex-1"/><Skeleton className="h-8 w-24"/><Skeleton className="h-8 w-28"/></div>)}</div>
}
