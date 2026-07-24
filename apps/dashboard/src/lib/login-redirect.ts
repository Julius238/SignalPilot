export type LoginRouter = {
  replace: (href: string) => void;
  refresh: () => void;
};

export function redirectAfterLogin(router: LoginRouter) {
  router.replace("/dashboard");
  router.refresh();
}
