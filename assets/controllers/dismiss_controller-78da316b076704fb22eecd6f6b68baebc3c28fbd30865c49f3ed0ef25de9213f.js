import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static values = {
    key: String
  }

  connect() {
    if (this.dismissed()) {
      this.hide()
    }
  }

  close() {
    localStorage.setItem(this.keyValue, "1")
    this.hide()
  }

  dismissed() {
    return localStorage.getItem(this.keyValue) === "1"
  }

  hide() {
    this.element.classList.add("hidden")
  }
};
