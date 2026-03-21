import { BASE_URL } from "@/env";
import { createRouter } from "@nanostores/router";

export const $router = createRouter({
  home: `${BASE_URL}`, // Home page
  onbord: `${BASE_URL}onboarding`, // Onboarding page
});