import type { JSX } from 'react';
import { cn } from '../../lib/utils';
import type { IconTileProps } from './icon-tile.types';

const iconTileClassName: string =
  'inline-flex size-8 shrink-0 items-center justify-center rounded-icon bg-sidebar-accent text-muted-foreground-secondary';
const iconTileGlyphClassName: string = 'size-4 shrink-0';

export function IconTile({ className, icon: Icon }: Readonly<IconTileProps>): JSX.Element {
  return (
    <span className={cn(iconTileClassName, className)}>
      <Icon aria-hidden="true" className={iconTileGlyphClassName} />
    </span>
  );
}
