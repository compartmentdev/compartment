import type { JSX } from 'react';
import type { BrowserSoftNavigateHandler } from '../browser-soft-navigation';
import { BrowserSoftNavigationLink } from './browser-soft-navigation-link';
import { cn } from '../lib/utils';

const compartmentLogoUrl: string = new URL('../assets/compartment-logo.svg', import.meta.url).href;

type CompartmentBrandJustify = 'center' | 'start';
type CompartmentBrandSize = 'default' | 'compact';

interface CompartmentBrandProps {
  className?: string | undefined;
  href?: string | undefined;
  justify?: CompartmentBrandJustify;
  onNavigate?: BrowserSoftNavigateHandler | undefined;
  size?: CompartmentBrandSize;
}

export function CompartmentBrand({
  className,
  href,
  justify = 'start',
  onNavigate,
  size = 'default',
}: Readonly<CompartmentBrandProps>): JSX.Element {
  const content: JSX.Element = renderBrandContent(className, justify, size);

  if (href === undefined) {
    return content;
  }

  return (
    <BrowserSoftNavigationLink className="inline-flex items-center no-underline" href={href} onNavigate={onNavigate}>
      {content}
    </BrowserSoftNavigationLink>
  );
}

function renderBrandContent(
  className: string | undefined,
  justify: CompartmentBrandJustify | undefined,
  size: CompartmentBrandSize,
): JSX.Element {
  const brandClassName: string = readBrandClassName(className, justify);
  const markClassName: string = readBrandMarkClassName(size);

  return (
    <span className={brandClassName}>
      <span
        aria-hidden="true"
        className={markClassName}
        style={{
          WebkitMaskImage: `url(${compartmentLogoUrl})`,
          maskImage: `url(${compartmentLogoUrl})`,
        }}
      />
      <span className="sr-only">Compartment</span>
    </span>
  );
}

function readBrandClassName(className: string | undefined, justify: CompartmentBrandJustify | undefined): string {
  return cn(
    'compartment-brand inline-flex items-center text-foreground',
    justify === 'center' ? 'justify-center' : 'justify-start',
    className,
  );
}

function readBrandMarkClassName(size: CompartmentBrandSize): string {
  return cn('compartment-brand-mark block shrink-0', size === 'compact' ? 'compartment-brand-mark-compact' : '');
}
