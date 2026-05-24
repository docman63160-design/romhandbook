import { Controller } from "@hotwired/stimulus";
import { get } from "@rails/request.js";

export default class extends Controller {
  static fetching = false; // debounce
  static pageValue = 0; // page number

  static values = {
    url: String,
    page: { type: Number, default: 1 },
  };

  static targets = ["items", "noRecords"];

  initialize() {
    this.scroll = this.scroll.bind(this);
    this.pageValue = 2;
  }

  connect() {
    document.addEventListener("scroll", this.scroll);
  }

  disconnect() {
    document.removeEventListener("scroll", this.scroll);
  }

  scroll() {
    if (this.#pageEnd && !this.fetching && !this.hasNoRecordsTarget) {
      this.#loadRecords();
    }
  }

  // Send a turbo-stream request to the controller.
  async #loadRecords() {
    const url = new URL(this.urlValue + window.location.search);
    url.searchParams.set("page", this.pageValue);

    this.fetching = true;

    await get(url.toString(), {
      responseKind: "turbo-stream",
    });

    this.fetching = false;
    this.pageValue += 1;
  }

  // Detect if we're at the bottom of the page.
  get #pageEnd() {
    const { scrollHeight, scrollTop, clientHeight } = document.documentElement;
    return scrollHeight - scrollTop - clientHeight < 200;
  }
};
