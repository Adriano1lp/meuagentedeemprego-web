import { Button } from './ui/button';
import { SupportLink } from './SupportLink';

type GenericErrorProps = {
  message: string;
  onRetry: () => void;
  retryTestId: string;
  testId?: string;
};

export function GenericError({
  message,
  onRetry,
  retryTestId,
  testId,
}: GenericErrorProps) {
  return (
    <div data-testid={testId} role="status" className="min-w-0">
      <p className="break-words text-sm">{message}</p>
      <Button
        type="button"
        data-testid={retryTestId}
        onClick={onRetry}
        variant="outline"
        size="sm"
        className="mt-3"
      >
        Tentar de novo
      </Button>
      <p className="mt-3 min-w-0">
        <SupportLink data-testid="support-link-error" className="max-w-full">
          Se continuar, fale com o suporte
        </SupportLink>
      </p>
    </div>
  );
}
