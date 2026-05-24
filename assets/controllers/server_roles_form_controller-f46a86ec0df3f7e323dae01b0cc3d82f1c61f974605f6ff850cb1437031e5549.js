import { Controller } from "@hotwired/stimulus"

export default class extends Controller {
  static targets = ["checkbox", "error"]

  submit(event) {
    const selectedRoles = this.checkboxTargets
      .filter((checkbox) => checkbox.checked)
      .map((checkbox) => checkbox.value)

    if (selectedRoles.length === 0) {
      event.preventDefault()
      this.showError()
      return
    }

    this.hideError()
    this.syncHiddenInputs(event.target, selectedRoles)
  }

  validate() {
    if (this.checkboxTargets.some((checkbox) => checkbox.checked)) {
      this.hideError()
    }
  }

  syncHiddenInputs(form, selectedRoles) {
    const container = form.querySelector('[data-server-roles-form-target="hiddenInputs"]')
    if (!container) return

    container.innerHTML = ""

    selectedRoles.forEach((role) => {
      const input = document.createElement("input")
      input.type = "hidden"
      input.name = "server_roles[]"
      input.value = role
      container.appendChild(input)
    })
  }

  showError() {
    this.errorTarget.classList.remove("hidden")
  }

  hideError() {
    this.errorTarget.classList.add("hidden")
  }
};
