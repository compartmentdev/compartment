import { minidenticon } from 'minidenticons';
import { useMemo, type JSX } from 'react';
import { cn } from '../../lib/utils';

interface MinidenticonAvatarProps {
  alt?: string | undefined;
  className?: string | undefined;
  imageClassName?: string | undefined;
  lightness?: number | string | undefined;
  saturation?: number | string | undefined;
  seed: string;
}

const defaultMinidenticonSaturation: number = 88;
const defaultMinidenticonLightness: number = 48;

export function MinidenticonAvatar({
  alt = '',
  className,
  imageClassName,
  lightness = defaultMinidenticonLightness,
  saturation = defaultMinidenticonSaturation,
  seed,
}: Readonly<MinidenticonAvatarProps>): JSX.Element {
  const src: string = useMemo(
    (): string => readMinidenticonDataUri(seed, saturation, lightness),
    [seed, saturation, lightness],
  );

  return (
    <span
      className={cn('inline-flex size-8 shrink-0 overflow-hidden rounded-pill border border-border bg-card', className)}
    >
      <img alt={alt} className={cn('block size-full', imageClassName)} src={src} />
    </span>
  );
}

function readMinidenticonDataUri(seed: string, saturation: number | string, lightness: number | string): string {
  return `data:image/svg+xml;utf8,${encodeURIComponent(minidenticon(seed, saturation, lightness))}`;
}
