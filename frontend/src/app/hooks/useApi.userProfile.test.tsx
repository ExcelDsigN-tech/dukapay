import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { queryKeys, useUpdateUserProfile, type UserProfile } from "./useApi";
import { useUserStore } from "../stores/useUserStore";

const mockToastError = jest.fn();

jest.mock("./useContractToast", () => ({
  useContractToast: () => ({ error: mockToastError }),
}));

function createTestHarness() {
  const queryClient = new QueryClient({
    defaultOptions: {
      mutations: { retry: false },
      queries: { retry: false },
    },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const initialProfile: UserProfile = {
  id: "user1",
  email: "old@example.com",
  displayName: "Old name",
  kycVerified: false,
};

describe("useUpdateUserProfile", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    mockToastError.mockClear();
    useUserStore.getState().setUser({ ...initialProfile });
  });

  afterEach(() => {
    global.fetch = originalFetch;
    useUserStore.getState().clearUser();
  });

  it("PATCHes the profile and commits the returned profile", async () => {
    const updatedProfile = { ...initialProfile, email: "new@example.com", displayName: "New name" };
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => updatedProfile,
    });
    global.fetch = fetchMock as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    queryClient.setQueryData(queryKeys.user.profile(), initialProfile);

    const { result } = renderHook(() => useUpdateUserProfile(), { wrapper });
    result.current.mutate({ displayName: "New name", email: "new@example.com" });

    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(fetchMock).toHaveBeenCalledWith(
      "http://localhost:3001/user/profile",
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({ displayName: "New name", email: "new@example.com" }),
      }),
    );
    expect(queryClient.getQueryData(queryKeys.user.profile())).toEqual(updatedProfile);
    expect(useUserStore.getState().user).toMatchObject({
      email: "new@example.com",
      displayName: "New name",
    });
  });

  it("rolls back optimistic data and reports API failures", async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: async () => ({ message: "Profile update failed" }),
    }) as unknown as typeof fetch;
    const { queryClient, wrapper } = createTestHarness();
    queryClient.setQueryData(queryKeys.user.profile(), initialProfile);

    const { result } = renderHook(() => useUpdateUserProfile(), { wrapper });
    result.current.mutate({ displayName: "Changed name", email: "changed@example.com" });

    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(queryClient.getQueryData(queryKeys.user.profile())).toEqual(initialProfile);
    expect(useUserStore.getState().user).toMatchObject({
      email: "old@example.com",
      displayName: "Old name",
    });
    expect(mockToastError).toHaveBeenCalledWith("Failed to save profile", "Profile update failed");
  });
});
