import type { JSX } from 'react';
import type { GitConnectFormInput } from './onboarding-page.types';

interface GitSelectedSourcePanelProps {
  formInput: GitConnectFormInput;
}

interface GitSourceSummaryProps {
  label: string;
  value: string;
}

export function GitSelectedSourcePanel({ formInput }: Readonly<GitSelectedSourcePanelProps>): JSX.Element {
  return (
    <aside className="grid content-start gap-3 rounded-lg border border-black/10 bg-white p-4">
      <p className="text-[12px] font-medium uppercase text-[#485259]">Selected source</p>
      <GitSourceSummary label="Repository" value={`${formInput.repository.owner}/${formInput.repository.name}`} />
      <GitSourceSummary label="Branch" value={formInput.branchName} />
      <GitSourceSummary label="Environment" value={formInput.environmentName} />
    </aside>
  );
}

function GitSourceSummary({ label, value }: Readonly<GitSourceSummaryProps>): JSX.Element {
  return (
    <div>
      <p className="text-[12px] leading-5 text-[#707b82]">{label}</p>
      <p className="break-words text-[13px] font-medium leading-5 text-[#111212]">{value}</p>
    </div>
  );
}
