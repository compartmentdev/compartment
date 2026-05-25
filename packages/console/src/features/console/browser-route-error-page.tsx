import type { JSX } from 'react';
import { useLocation, useRouteError, type Location } from 'react-router';
import { CompartmentBrand } from '../../components/compartment-brand';
import { Button, buttonVariants } from '../../components/ui/button';
import { createBrowserRouteErrorViewModel, type BrowserRouteErrorViewModel } from './browser-route-error';

type BrowserRouteErrorInput = object | string | number | boolean | bigint | symbol | null | undefined;

interface BrowserRouteErrorPageProps {
  viewModel: BrowserRouteErrorViewModel;
}

interface ErrorStatusBadgeProps {
  statusCode?: number | undefined;
}

interface ErrorDetailsProps {
  details: string;
}

export function BrowserRouteErrorBoundary(): JSX.Element {
  const location: Location = useLocation();
  const error: BrowserRouteErrorInput = useRouteError() as BrowserRouteErrorInput;

  return (
    <BrowserRouteErrorPage
      viewModel={createBrowserRouteErrorViewModel(error, import.meta.env.DEV, location.pathname, location.search)}
    />
  );
}

function BrowserRouteErrorPage({ viewModel }: Readonly<BrowserRouteErrorPageProps>): JSX.Element {
  return (
    <main className="min-h-screen bg-transparent text-foreground">
      <div className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-4 py-12">
        <section className="rounded-[1.75rem] border border-border bg-card/95 p-6 shadow-sm sm:p-8">
          <BrowserRouteErrorHero viewModel={viewModel} />
          {viewModel.details !== undefined ? <ErrorDetails details={viewModel.details} /> : null}
        </section>
      </div>
    </main>
  );
}

function BrowserRouteErrorHero({ viewModel }: Readonly<BrowserRouteErrorPageProps>): JSX.Element {
  return (
    <div className="flex flex-col items-center text-center">
      <CompartmentBrand className="mb-6" justify="center" />
      <ErrorStatusBadge statusCode={viewModel.statusCode} />
      <h1 className="mt-4 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{viewModel.title}</h1>
      <p className="mt-3 max-w-xl text-[15px] leading-6 text-muted-foreground">{viewModel.message}</p>
      <BrowserRouteErrorActions viewModel={viewModel} />
    </div>
  );
}

function BrowserRouteErrorActions({ viewModel }: Readonly<BrowserRouteErrorPageProps>): JSX.Element {
  return (
    <div className="mt-6 flex flex-col gap-3 sm:flex-row">
      <a className={buttonVariants({ size: 'lg' })} href={viewModel.primaryActionHref}>
        {viewModel.primaryActionLabel}
      </a>
      <Button onClick={reloadBrowserPage} size="lg" type="button" variant="outline">
        Reload page
      </Button>
    </div>
  );
}

function ErrorStatusBadge({ statusCode }: Readonly<ErrorStatusBadgeProps>): JSX.Element {
  const label: string = statusCode === undefined ? 'Browser console error' : `Error ${statusCode}`;

  return (
    <span className="inline-flex items-center rounded-full border border-border bg-secondary px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
      {label}
    </span>
  );
}

function ErrorDetails({ details }: Readonly<ErrorDetailsProps>): JSX.Element {
  return (
    <details className="mt-8 rounded-2xl border border-border bg-muted/40 p-4">
      <summary className="cursor-pointer text-[13px] font-medium text-foreground">Development details</summary>
      <pre className="mt-3 overflow-x-auto whitespace-pre-wrap text-[12px] leading-5 text-muted-foreground">
        {details}
      </pre>
    </details>
  );
}

function reloadBrowserPage(): void {
  window.location.reload();
}
