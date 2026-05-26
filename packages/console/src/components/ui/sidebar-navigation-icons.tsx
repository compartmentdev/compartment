import { forwardRef, type ForwardedRef, type JSX } from 'react';
import type { LucideIcon, LucideProps } from './icons';

export const SidebarUsersIcon: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(function SidebarUsersIcon(
  props: LucideProps,
  ref: ForwardedRef<SVGSVGElement>,
): JSX.Element {
  return (
    <svg
      fill="none"
      ref={ref}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M4.66666 13.7746V12.6666C4.66666 12.313 4.80714 11.9739 5.05719 11.7238C5.30724 11.4738 5.64637 11.3333 5.99999 11.3333H9.99999C10.3536 11.3333 10.6927 11.4738 10.9428 11.7238C11.1929 11.9739 11.3333 12.313 11.3333 12.6666V13.7746" />
      <path d="M14.6666 8C14.6666 11.6819 11.6819 14.6666 7.99999 14.6666C4.3181 14.6666 1.33333 11.6819 1.33333 8C1.33333 4.3181 4.3181 1.33333 7.99999 1.33333C11.6819 1.33333 14.6666 4.3181 14.6666 8Z" />
      <path d="M9.99999 6.66666C9.99999 7.77123 9.10456 8.66666 7.99999 8.66666C6.89542 8.66666 5.99999 7.77123 5.99999 6.66666C5.99999 5.56209 6.89542 4.66666 7.99999 4.66666C9.10456 4.66666 9.99999 5.56209 9.99999 6.66666Z" />
    </svg>
  );
});

export const SidebarGroupsIcon: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(function SidebarGroupsIcon(
  props: LucideProps,
  ref: ForwardedRef<SVGSVGElement>,
): JSX.Element {
  return (
    <svg
      fill="none"
      ref={ref}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M12 8C10.5272 8 9.33329 9.19391 9.33329 10.6667C9.33329 12.1394 10.5272 13.3333 12 13.3333C13.4727 13.3333 14.6666 12.1394 14.6666 10.6667C14.6666 9.19391 13.4727 8 12 8Z" />
      <path d="M3.99996 8C2.5272 8 1.33329 9.19391 1.33329 10.6667C1.33329 12.1394 2.5272 13.3333 3.99996 13.3333C5.47272 13.3333 6.66663 12.1394 6.66663 10.6667C6.66663 9.19391 5.47272 8 3.99996 8Z" />
      <path d="M7.99996 1.33334C6.5272 1.33334 5.33329 2.52725 5.33329 4.00001C5.33329 5.47276 6.5272 6.66667 7.99996 6.66667C9.47272 6.66667 10.6666 5.47276 10.6666 4.00001C10.6666 2.52725 9.47272 1.33334 7.99996 1.33334Z" />
    </svg>
  );
});

export const SidebarAuditLogsIcon: LucideIcon = forwardRef<SVGSVGElement, LucideProps>(function SidebarAuditLogsIcon(
  props: LucideProps,
  ref: ForwardedRef<SVGSVGElement>,
): JSX.Element {
  return (
    <svg
      fill="none"
      ref={ref}
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.5"
      viewBox="0 0 16 16"
      xmlns="http://www.w3.org/2000/svg"
      {...props}
    >
      <path d="M4.66667 4H14M4.66667 8H14M4.66667 12H14M2 4H2.00667M2 8H2.00667M2 12H2.00667" />
    </svg>
  );
});
