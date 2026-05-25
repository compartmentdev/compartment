import type { AccessGroupMemberSummary } from '@compartment/contracts/browser';
import type { JSX } from 'react';
import { ComboBox, type ComboBoxOption } from '../../components/combo-box';
import {
  type GroupMemberSearchState,
  type GroupMemberSuggestion,
  useGroupMemberSuggestions,
} from './groups-page.member-autocomplete.search';

type GroupMemberStatus = 'active' | 'invited';

interface GroupMemberAutocompleteFieldProps {
  memberEmail: string;
  members: AccessGroupMemberSummary[];
  organizationSlug: string | null;
  setMemberEmail: (value: string) => void;
}

export function GroupMemberAutocompleteField(props: Readonly<GroupMemberAutocompleteFieldProps>): JSX.Element {
  const search: GroupMemberSearchState = useGroupMemberSuggestions(
    props.organizationSlug,
    props.memberEmail,
    props.members,
  );

  return (
    <ComboBox
      className="flex-1"
      emptyMessage="No matching users."
      inputValue={props.memberEmail}
      isLoading={search.isLoading}
      loadingMessage="Searching users..."
      minQueryLength={2}
      onChange={props.setMemberEmail}
      onFocusChange={search.setIsFocused}
      onInputChange={props.setMemberEmail}
      options={readGroupMemberOptions(search.suggestions)}
      placeholder="Search users by email"
      required
    />
  );
}

function readGroupMemberOptions(suggestions: GroupMemberSuggestion[]): ComboBoxOption[] {
  return suggestions.map(
    (suggestion: GroupMemberSuggestion): ComboBoxOption => ({
      label: suggestion.email,
      supportingText: readGroupMemberSuggestionStatusLabel(suggestion.status),
      value: suggestion.email,
    }),
  );
}

function readGroupMemberSuggestionStatusLabel(status: GroupMemberStatus): string {
  return status === 'active' ? 'Active' : 'Invited';
}
