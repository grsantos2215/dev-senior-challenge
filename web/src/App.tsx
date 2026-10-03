import { Button } from "./components/ui/button"
import { Input } from "./components/ui/input"

export default function App() {
  return (
    <div className="flex min-h-svh p-6">
      <div className="m-auto flex w-full max-w-md min-w-0 flex-col gap-4 text-sm leading-loose">
        <div className="w-full space-y-4">
          <h1 className="text-center text-2xl font-medium">
            Totem de atendimento
          </h1>
          <form className="space-y-2">
            <Input placeholder="CPF" />
            <Button size="lg" className="w-full" type="submit">
              Continuar
            </Button>
          </form>
        </div>
      </div>
    </div>
  )
}
