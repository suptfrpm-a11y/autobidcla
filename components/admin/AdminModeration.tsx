import React, { useState, useEffect } from 'react';
import { ShieldAlert, CheckCircle2, AlertTriangle, X } from 'lucide-react';
import { db, collection, onSnapshot, updateDoc, doc } from '../../firebase';
import { ModerationReport, User, Vehicle } from '../../types';
import { logAdminAction } from './adminAuditHelper';

interface AdminModerationProps {
  currentUser: User;
  vehicles: Vehicle[];
}

export const AdminModeration: React.FC<AdminModerationProps> = ({ currentUser }) => {
  const [reports, setReports] = useState<ModerationReport[]>([]);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'actioned'>('pending');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'moderation_reports'), (snap) => {
      const list: ModerationReport[] = [];
      snap.forEach(d => list.push({ id: d.id, ...d.data() } as ModerationReport));
      list.sort((a, b) => b.createdAt - a.createdAt);
      setReports(list);
    });
    return () => unsub();
  }, []);

  const handleDismissReport = async (report: ModerationReport) => {
    setErrorMsg(null);
    try {
      await updateDoc(doc(db, 'moderation_reports', report.id), {
        status: 'dismissed',
        reviewedBy: currentUser.email,
        actionTaken: 'Dismissed as false report'
      });
      await logAdminAction(currentUser, 'DISMISS_REPORT', 'moderation_reports', report.id, `Dismissed report against ${report.targetType} ${report.targetId}`);
    } catch (err: any) {
      setErrorMsg('Failed to dismiss report: ' + err.message);
    }
  };

  const handleBlacklistVehicle = async (report: ModerationReport) => {
    setErrorMsg(null);
    try {
      await updateDoc(doc(db, 'vehicles', report.targetId), {
        isBlacklisted: true,
        status: 'Ended'
      });
      await updateDoc(doc(db, 'moderation_reports', report.id), {
        status: 'actioned',
        reviewedBy: currentUser.email,
        actionTaken: 'Vehicle Blacklisted & De-listed'
      });
      await logAdminAction(
        currentUser,
        'BLACKLIST_VEHICLE',
        'vehicles',
        report.targetId,
        `Blacklisted vehicle "${report.targetTitle}" following report: ${report.reason}`
      );
    } catch (err: any) {
      setErrorMsg('Error blacklisting vehicle: ' + err.message);
    }
  };

  const filteredReports = reports.filter(r => {
    if (statusFilter === 'all') return true;
    if (statusFilter === 'pending') return r.status === 'pending';
    return r.status === 'actioned' || r.status === 'dismissed';
  });

  return (
    <div className="space-y-6">
      {errorMsg && (
        <div className="p-3.5 bg-red-50 border border-red-200 text-red-800 rounded-lg text-xs font-medium flex items-center justify-between">
          <span className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
            <span>{errorMsg}</span>
          </span>
          <button type="button" onClick={() => setErrorMsg(null)} className="cursor-pointer">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-white p-5 rounded-lg border border-gray-200 shadow-xs">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-100 border border-gray-200 flex items-center justify-center text-gray-700 shrink-0">
            <ShieldAlert className="w-5 h-5" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Content Moderation & Fraud Shield</h2>
            <p className="text-xs text-gray-500 mt-1">
              Review user-reported listings, odometer discrepancies, and flagged marketplace items.
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setStatusFilter('pending')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer tabular-nums ${
              statusFilter === 'pending'
                ? 'bg-red-600 text-white border-red-600'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            Pending Queue ({reports.filter(r => r.status === 'pending').length})
          </button>
          <button
            type="button"
            onClick={() => setStatusFilter('all')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border cursor-pointer tabular-nums ${
              statusFilter === 'all'
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
            }`}
          >
            All Reports ({reports.length})
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden shadow-xs">
        {filteredReports.length === 0 ? (
          <div className="py-16 text-center text-gray-500 space-y-2">
            <div className="w-10 h-10 mx-auto rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-5 h-5" />
            </div>
            <h4 className="font-semibold text-gray-900 text-sm">Moderation Queue Clear</h4>
            <p className="text-xs text-gray-500 max-w-sm mx-auto">
              No flagged listings or user reports require attention at this time.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredReports.map((report) => (
              <div key={report.id} className="p-5 flex flex-col md:flex-row items-start md:items-center justify-between gap-4 hover:bg-gray-50 transition-colors">
                <div className="space-y-1.5 max-w-xl">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="px-2 py-0.5 rounded-lg text-[11px] font-medium bg-red-50 text-red-700 border border-red-200">
                      {report.targetType} Flagged
                    </span>
                    <span className="text-xs text-gray-500 tabular-nums">
                      Reported {new Date(report.createdAt).toLocaleDateString()}
                    </span>
                    {report.status !== 'pending' && (
                      <span className={`px-2 py-0.5 rounded-lg text-[11px] font-medium border ${
                        report.status === 'actioned'
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-gray-100 text-gray-600 border-gray-200'
                      }`}>
                        {report.status.toUpperCase()}
                      </span>
                    )}
                  </div>

                  <h4 className="font-semibold text-gray-900 text-sm">{report.targetTitle}</h4>
                  <div className="text-xs text-gray-700">
                    <strong className="text-gray-900">Reason:</strong> {report.reason}
                  </div>
                  {report.details && (
                    <p className="text-xs text-gray-600 bg-gray-50 p-2.5 rounded-lg border border-gray-200">
                      "{report.details}"
                    </p>
                  )}
                  {report.actionTaken && (
                    <div className="text-xs font-medium text-emerald-700">
                      Action taken: {report.actionTaken} (by {report.reviewedBy})
                    </div>
                  )}
                </div>

                {report.status === 'pending' && (
                  <div className="flex items-center gap-2 w-full md:w-auto justify-end shrink-0">
                    <button
                      type="button"
                      onClick={() => handleDismissReport(report)}
                      className="px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 border border-gray-200 text-xs font-medium rounded-lg cursor-pointer"
                    >
                      Dismiss
                    </button>
                    <button
                      type="button"
                      onClick={() => handleBlacklistVehicle(report)}
                      className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white text-xs font-medium rounded-lg cursor-pointer"
                    >
                      Blacklist Listing
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
