import type { JSX } from 'react';

export function GitConnectHeader(): JSX.Element {
  return (
    <div>
      <h2 className="text-[24px] font-semibold leading-8">Connect GitHub</h2>
      <p className="mt-2 max-w-2xl text-[14px] leading-6 text-[#485259]">
        Install the GitHub App on the account that owns your repository so Compartment can read it, open descriptor PRs,
        and receive push events.
      </p>
    </div>
  );
}
