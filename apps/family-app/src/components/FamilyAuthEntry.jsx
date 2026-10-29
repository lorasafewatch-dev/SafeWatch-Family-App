import { useId } from 'react';
import { ArrowRight, Eye, EyeOff, KeyRound, LockKeyhole, Mail, UserRound } from 'lucide-react';
import AuthEntry from '../../../shared/components/AuthEntry.jsx';
import './FamilyAuthEntry.css';

function FamilyField({ label, icon: Icon, children, ...props }) {
  const id = useId();
  return <div className="family-auth__field">
    <label htmlFor={id}>{label}</label>
    <div className="family-auth__input-wrap">
      <Icon aria-hidden="true" />
      <input {...props} id={id} />
      {children}
    </div>
  </div>;
}

function FamilyAuthForm({
  mode, email, password, confirmation, fullName, resetCode, privacyAcceptance,
  showPassword, busy, error, message, cooldown, onSubmit, onModeChange,
  onEmailChange, onPasswordChange, onConfirmationChange, onNameChange, onCodeChange,
  onTogglePassword, onReviewTerms, onPrivacy, onResendConfirmation,
}) {
  const signup = mode === 'signup';
  const login = mode === 'login';
  const forgot = mode === 'forgot';
  const heading = signup ? 'Create your account' : forgot ? 'Forgot password?' : mode === 'code' ? 'Enter reset code' : 'Welcome back';
  const subtitle = signup
    ? 'Create a family account using a different email from your barangay account.'
    : forgot ? 'Enter your account email to request a password-reset link.'
      : mode === 'code' ? 'Enter the 6-digit code from your newest password-reset email.'
        : 'Sign in to your family space.';
  const action = busy ? 'Please wait…' : signup ? 'Sign up' : mode === 'code' ? 'Verify reset code'
    : forgot ? cooldown ? 'Request again in ' + cooldown + 's' : 'Send reset link' : 'Log in';
  const passwordToggle = label => <button type="button" disabled={busy} onClick={onTogglePassword}
    className="family-auth__eye" aria-label={(showPassword ? 'Hide ' : 'Show ') + label.toLowerCase()} aria-pressed={showPassword}>
    {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
  </button>;

  return <main className="family-auth" data-mode={mode} aria-label="SafeWatch Family account access">
    <div className="family-auth__shell">
      <header className="family-auth__intro">
        <div className="family-auth__brand">
          <div className="family-auth__mark" aria-hidden="true">
            <svg viewBox="0 0 64 64" fill="none">
              <path d="M32 40S45 27 45 18a13 13 0 1 0-26 0c0 9 13 22 13 22Z" fill="#f4fff9" />
              <circle cx="32" cy="18" r="5.3" fill="#008d75" />
              <path d="M11 45h7l4-10 7 19 5-13 4 5h6l3-12 5 13h4" stroke="#f4fff9" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div className="family-auth__wordmark">Safe<span>Watch.</span></div>
          <p className="family-auth__caption">Family</p>
        </div>
        <div className="family-auth__welcome">
          <h1>Care that stays close.</h1>
          <p>Health, location and safety, together.</p>
        </div>
      </header>

      <section className="family-auth__card" aria-labelledby="family-auth-heading">
        <header className="family-auth__card-header">
          <h2 id="family-auth-heading">{heading}</h2>
          <p>{subtitle}</p>
        </header>
        {error && <p role="alert" className="family-auth__message family-auth__message--error">{error}</p>}
        {message && <p role="status" className="family-auth__message">{message}</p>}
        <form onSubmit={onSubmit} className="family-auth__form">
          {signup && <FamilyField label="Full name" icon={UserRound} autoComplete="name" required maxLength={100}
            placeholder="Your full name" disabled={busy} value={fullName} onChange={event => onNameChange(event.target.value)} />}
          <FamilyField label="Email address" icon={Mail} type="email" autoComplete={login ? 'username' : 'email'}
            placeholder="you@example.com" required maxLength={254} disabled={busy} value={email} onChange={event => onEmailChange(event.target.value)} />
          {mode === 'code' && <FamilyField label="Reset code" icon={KeyRound} type="text" inputMode="numeric" autoComplete="one-time-code"
            placeholder="6-digit code" required pattern="[0-9]{6}" maxLength={6} disabled={busy} value={resetCode} onChange={event => onCodeChange(event.target.value)} />}
          {(login || signup) && <>
            <FamilyField label="Password" icon={LockKeyhole} type={showPassword ? 'text' : 'password'}
              placeholder="••••••••" autoComplete={signup ? 'new-password' : 'current-password'} required minLength={signup ? 8 : undefined}
              disabled={busy} value={password} onChange={event => onPasswordChange(event.target.value)}>{passwordToggle('Password')}</FamilyField>
            {signup && <FamilyField label="Confirm password" icon={LockKeyhole} type={showPassword ? 'text' : 'password'}
              placeholder="••••••••" autoComplete="new-password" required disabled={busy} value={confirmation}
              onChange={event => onConfirmationChange(event.target.value)}>{passwordToggle('Confirm password')}</FamilyField>}
          </>}
          {login && <button type="button" disabled={busy} className="family-auth__forgot" onClick={() => onModeChange('forgot')}>Forgot password?</button>}
          {signup && <div className="family-auth__helper">
            <p>Use at least 8 characters. Your account may require a stronger password.</p>
            <p>{privacyAcceptance ? 'Terms accepted for sign-up. You will confirm again at first login.' : 'Review the terms and account-data consent before signing up.'}{' '}
              <button type="button" disabled={busy} onClick={onReviewTerms}>Review sign-up terms</button>
            </p>
          </div>}
          <button className="family-auth__primary" disabled={busy || (forgot && cooldown > 0)}>
            <span>{action}</span>{!busy && <ArrowRight aria-hidden="true" />}
          </button>
        </form>
        {(login || forgot) && <button type="button" disabled={busy} className="family-auth__text-link family-auth__recovery" onClick={() => onModeChange('code')}>Enter reset code</button>}
        {login ? <>
          <div className="family-auth__divider">New to SafeWatch?</div>
          <button type="button" disabled={busy} className="family-auth__secondary" onClick={() => onModeChange('signup')}>Create an account</button>
          <button type="button" disabled={busy} className="family-auth__text-link family-auth__confirmation" onClick={onResendConfirmation}>Resend confirmation email</button>
        </> : <button type="button" disabled={busy} className="family-auth__text-link family-auth__back" onClick={() => onModeChange('login')}>Back to login</button>}
      </section>

      <footer className="family-auth__footer">
        <button type="button" disabled={busy} onClick={onPrivacy}>Terms and Conditions &amp; Privacy Notice</button>
      </footer>
    </div>
  </main>;
}

export default function FamilyAuthEntry(props) {
  return <AuthEntry {...props} app="family" FormComponent={FamilyAuthForm} />;
}
