function createWindowCloseHandler({ isQuitting, hide }) {
  return (event) => {
    if (isQuitting()) return;
    event.preventDefault();
    hide();
  };
}

module.exports = { createWindowCloseHandler };
