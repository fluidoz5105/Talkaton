(function updateCopyrightYears() {
  var yearRange = "2026 - " + new Date().getFullYear();
  document.querySelectorAll("[data-current-year]").forEach(function (element) {
    element.textContent = yearRange;
  });
})();
