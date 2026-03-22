// banking_api_ui/src/components/education/PingOneAuthorizePanel.js
import React from 'react';
import EducationDrawer from '../shared/EducationDrawer';

export default function PingOneAuthorizePanel({ isOpen, onClose, initialTabId }) {
  const tabs = [
    {
      id: 'what',
      label: 'What it does',
      content: (
        <>
          <p>
            <strong>PingOne Authorize</strong> provides policy-based decisions (PDP) for transfers and withdrawals.
            When enabled, the Banking API asks PingOne whether the action is allowed under your configured policy.
          </p>
        </>
      ),
    },
    {
      id: 'policy',
      label: 'Policy configuration',
      content: (
        <>
          <p>
            Create a <strong>Policy Decision Point</strong> in PingOne Authorize and copy its ID into Security Settings.
            The Worker app credentials (client ID/secret) must be configured on the server for token exchange to Authorize.
          </p>
        </>
      ),
    },
  ];

  return (
    <EducationDrawer
      isOpen={isOpen}
      onClose={onClose}
      title="PingOne Authorize"
      tabs={tabs}
      initialTabId={initialTabId}
    />
  );
}
