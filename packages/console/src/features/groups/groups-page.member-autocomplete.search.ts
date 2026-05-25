import {
  type AccessGroupMemberSummary,
  type OrganizationUserListRow,
  userListResponseSchema,
} from '@compartment/contracts/browser';
import { useEffect, useMemo, useState } from 'react';
import { requestBrowserApi } from '../../lib/browser-api';
import { usersApiPathname } from '../../routes/users/users-api-paths';

export type GroupMemberSuggestion = OrganizationUserListRow;

export interface GroupMemberSearchState {
  isFocused: boolean;
  isLoading: boolean;
  setIsFocused: (value: boolean) => void;
  suggestions: GroupMemberSuggestion[];
}

const groupMemberSuggestionDebounceMs: number = 250;
const groupMemberSuggestionLimit: number = 8;
const groupMemberSuggestionMinQueryLength: number = 2;

export function useGroupMemberSuggestions(
  organizationSlug: string | null,
  memberEmail: string,
  members: AccessGroupMemberSummary[],
): GroupMemberSearchState {
  const [isFocused, setIsFocused] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [suggestions, setSuggestions] = useState<GroupMemberSuggestion[]>([]);
  const existingMemberEmails: Set<string> = useExistingMemberEmails(members);

  useGroupMemberSuggestionEffect(
    existingMemberEmails,
    isFocused,
    memberEmail,
    organizationSlug,
    setIsLoading,
    setSuggestions,
  );

  return { isFocused, isLoading, setIsFocused, suggestions };
}

function useExistingMemberEmails(members: AccessGroupMemberSummary[]): Set<string> {
  return useMemo((): Set<string> => new Set(members.map(readMemberEmail)), [members]);
}

function useGroupMemberSuggestionEffect(
  existingMemberEmails: Set<string>,
  isFocused: boolean,
  memberEmail: string,
  organizationSlug: string | null,
  setIsLoading: (value: boolean) => void,
  setSuggestions: (value: GroupMemberSuggestion[]) => void,
): void {
  useEffect((): (() => void) => {
    const query: string = memberEmail.trim();
    if (!isFocused || organizationSlug === null || query.length < groupMemberSuggestionMinQueryLength) {
      return resetGroupMemberSuggestions(setIsLoading, setSuggestions);
    }

    return scheduleGroupMemberSuggestionLoad(
      existingMemberEmails,
      organizationSlug,
      query,
      setIsLoading,
      setSuggestions,
    );
  }, [existingMemberEmails, isFocused, memberEmail, organizationSlug, setIsLoading, setSuggestions]);
}

function resetGroupMemberSuggestions(
  setIsLoading: (value: boolean) => void,
  setSuggestions: (value: GroupMemberSuggestion[]) => void,
): () => void {
  setIsLoading(false);
  setSuggestions([]);
  return (): void => undefined;
}

function scheduleGroupMemberSuggestionLoad(
  existingMemberEmails: Set<string>,
  organizationSlug: string,
  query: string,
  setIsLoading: (value: boolean) => void,
  setSuggestions: (value: GroupMemberSuggestion[]) => void,
): () => void {
  let isCancelled: boolean = false;
  const timeoutId: number = window.setTimeout((): void => {
    setIsLoading(true);
    void fetchGroupMemberSuggestions(
      existingMemberEmails,
      organizationSlug,
      query,
      setSuggestions,
      setIsLoading,
      (): boolean => isCancelled,
    );
  }, groupMemberSuggestionDebounceMs);

  return (): void => {
    isCancelled = true;
    window.clearTimeout(timeoutId);
  };
}

async function fetchGroupMemberSuggestions(
  existingMemberEmails: Set<string>,
  organizationSlug: string,
  query: string,
  setSuggestions: (value: GroupMemberSuggestion[]) => void,
  setIsLoading: (value: boolean) => void,
  isCancelled: () => boolean,
): Promise<void> {
  try {
    const response: { users: GroupMemberSuggestion[] } = await fetchUserSuggestionResponse(organizationSlug, query);
    if (!isCancelled()) {
      setSuggestions(filterAvailableGroupMemberSuggestions(existingMemberEmails, response.users));
    }
  } catch {
    if (!isCancelled()) {
      setSuggestions([]);
    }
  } finally {
    if (!isCancelled()) {
      setIsLoading(false);
    }
  }
}

async function fetchUserSuggestionResponse(
  organizationSlug: string,
  query: string,
): Promise<{ users: GroupMemberSuggestion[] }> {
  return await requestBrowserApi(buildUserSuggestionSearchPath(query), userListResponseSchema, {
    currentOrganization: organizationSlug,
  });
}

function filterAvailableGroupMemberSuggestions(
  existingMemberEmails: Set<string>,
  users: GroupMemberSuggestion[],
): GroupMemberSuggestion[] {
  return users.filter((user: GroupMemberSuggestion): boolean => !existingMemberEmails.has(user.email));
}

function buildUserSuggestionSearchPath(query: string): string {
  const searchParams: URLSearchParams = new URLSearchParams({
    orderBy: 'email',
    page: '1',
    perPage: String(groupMemberSuggestionLimit),
    search: query,
    sort: 'asc',
  });

  return `${usersApiPathname}?${searchParams.toString()}`;
}

function readMemberEmail(member: AccessGroupMemberSummary): string {
  return member.email;
}
