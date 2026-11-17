/* REMIXT · Ingreso de operadores y choferes */
(function () {
  const Auth = window.RemixtAuth;
  const $ = (sel) => document.querySelector(sel);
  const CAMPOS = {
    operador: { label: 'Email', type: 'email', placeholder: 'tu@email.com', sub: 'Acceso al panel de gestión y despacho.' },
    chofer: { label: 'Teléfono', type: 'tel', placeholder: '711 000 0000', sub: 'Ingresá con el teléfono registrado en tu ficha.' },
  };
  let rol = new URLSearchParams(window.location.search).get('rol') === 'chofer' ? 'chofer' : 'operador';

  function irAlInicio(destino) {
    window.location.replace(Auth.HOME[destino]);
  }

  function aplicarRol() {
    const campo = CAMPOS[rol];
    document.querySelectorAll('.role-switch button').forEach((b) => {
      const activo = b.dataset.rol === rol;
      b.classList.toggle('is-active', activo);
      b.setAttribute('aria-selected', String(activo));
    });
    const input = $('#loginUsuario');
    $('#loginUsuarioLabel').textContent = campo.label;
    input.type = campo.type;
    input.placeholder = campo.placeholder;
    $('#loginSub').textContent = campo.sub;
    $('#loginError').hidden = true;
  }

  document.querySelector('.role-switch').addEventListener('click', (event) => {
    const boton = event.target.closest('button[data-rol]');
    if (!boton || boton.dataset.rol === rol) return;
    if (Auth.leer(boton.dataset.rol)) { irAlInicio(boton.dataset.rol); return; }
    rol = boton.dataset.rol;
    $('#loginUsuario').value = '';
    aplicarRol();
    $('#loginUsuario').focus();
  });

  $('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const boton = $('#loginBtn');
    const error = $('#loginError');
    error.hidden = true;
    boton.disabled = true;
    boton.textContent = 'Ingresando…';
    try {
      const res = await Auth.api('POST', '/api/auth/login', {
        rol,
        usuario: $('#loginUsuario').value.trim(),
        password: $('#loginPassword').value,
      });
      Auth.guardar(res.data);
      irAlInicio(rol);
    } catch (err) {
      error.textContent = err.message;
      error.hidden = false;
      boton.disabled = false;
      boton.textContent = 'Ingresar';
    }
  });

  if (Auth.leer(rol)) irAlInicio(rol);
  else aplicarRol();
})();
