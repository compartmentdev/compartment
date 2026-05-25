import type { JSX, ReactNode } from 'react';
import { CompartmentBrand } from '../../components/compartment-brand';
import { DismissibleAlert } from '../../components/dismissible-alert';

interface AuthPageShellProps {
  brandJustify?: 'center' | 'start' | undefined;
  className?: string | undefined;
  children: ReactNode;
  description?: string | undefined;
  descriptionClassName?: string | undefined;
  errorMessage?: string | undefined;
  errorMessageId?: number | undefined;
  pageClassName?: string | undefined;
  titleBlockClassName?: string | undefined;
  title: string;
}

export function AuthPageShell(props: Readonly<AuthPageShellProps>): JSX.Element {
  return (
    <div className={readAuthPageClassName(props.pageClassName)}>
      <AuthPageShellBody {...props} />
    </div>
  );
}

function AuthPageShellBody({
  brandJustify = 'center',
  children,
  className,
  description,
  descriptionClassName,
  errorMessage,
  errorMessageId,
  title,
  titleBlockClassName,
}: Readonly<AuthPageShellProps>): JSX.Element {
  return (
    <main className={readAuthCardClassName(className)}>
      <CompartmentBrand className="auth-brand" justify={brandJustify} />
      <AuthPageTitleBlock
        description={description}
        descriptionClassName={descriptionClassName}
        title={title}
        titleBlockClassName={titleBlockClassName}
      />
      <DismissibleAlert className="mt-5" message={errorMessage} messageId={errorMessageId} variant="error" />
      {children}
    </main>
  );
}

function readAuthCardClassName(className: string | undefined): string {
  return className ?? 'auth-shell-card w-full max-w-[500px] p-10';
}

function AuthPageTitleBlock({
  description,
  descriptionClassName,
  title,
  titleBlockClassName,
}: Readonly<
  Pick<AuthPageShellProps, 'description' | 'descriptionClassName' | 'title' | 'titleBlockClassName'>
>): JSX.Element {
  return (
    <div className={titleBlockClassName ?? 'mt-10 space-y-3'}>
      <h1 className="auth-shell-heading text-[var(--auth-foreground)]">{title}</h1>
      <AuthPageDescription className={descriptionClassName} description={description} />
    </div>
  );
}

function readAuthPageClassName(pageClassName: string | undefined): string {
  return (
    pageClassName ??
    'grid min-h-screen place-items-center bg-[var(--auth-page-bg)] px-4 py-8 text-[var(--auth-foreground)]'
  );
}

function AuthPageDescription({
  className,
  description,
}: Readonly<{ className?: string | undefined; description?: string | undefined }>): JSX.Element | null {
  if (description === undefined) {
    return null;
  }

  return (
    <p className={className ?? 'w-full max-w-[420px] text-[14px] leading-5 text-[var(--auth-secondary-foreground)]'}>
      {description}
    </p>
  );
}
